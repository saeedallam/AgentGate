require('reflect-metadata');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const { JwtService } = require('@nestjs/jwt');

const {
  createTokenOptions,
  ACCESS_TOKEN_TTL_SECONDS,
} = require('../dist/auth/token.config.js');

const {
  AccessTokenService,
} = require('../dist/auth/access-token.service.js');

test('JWT configuration rejects missing and malformed secrets', () => {
  for (const secret of [undefined, '', 'short', 'z'.repeat(64)]) {
    assert.throws(() => createTokenOptions(secret));
  }
});

test('access token has the expected identity, audience and lifetime', async () => {
  const secret = randomBytes(32).toString('hex');
  const jwt = new JwtService(createTokenOptions(secret));
  const tokens = new AccessTokenService(jwt);
  const userId = randomUUID();

  const response = await tokens.issue(userId);
  const payload = await jwt.verifyAsync(response.accessToken);

  assert.equal(response.tokenType, 'Bearer');
  assert.equal(response.expiresIn, ACCESS_TOKEN_TTL_SECONDS);

  assert.equal(payload.sub, userId);
  assert.equal(payload.iss, 'agentgate');
  assert.equal(payload.aud, 'agentgate-api');
  assert.equal(payload.exp - payload.iat, 900);

  assert.deepEqual(
    Object.keys(payload).sort(),
    ['aud', 'exp', 'iat', 'iss', 'sub'],
  );

  // Simulate expiry without waiting for 15 minutes.
  await assert.rejects(
    jwt.verifyAsync(response.accessToken, {
      clockTimestamp: payload.exp,
    }),
    (error) => error.name === 'TokenExpiredError',
  );

  const otherJwt = new JwtService(
    createTokenOptions(randomBytes(32).toString('hex')),
  );

  await assert.rejects(
    otherJwt.verifyAsync(response.accessToken),
    (error) => error.name === 'JsonWebTokenError',
  );

  await assert.rejects(
    jwt.verifyAsync(response.accessToken, {
      audience: 'another-api',
    }),
    (error) => error.name === 'JsonWebTokenError',
  );

  await assert.rejects(
    jwt.verifyAsync(response.accessToken, {
      issuer: 'another-issuer',
    }),
    (error) => error.name === 'JsonWebTokenError',
  );
});