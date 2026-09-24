require('reflect-metadata');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const { JwtService } = require('@nestjs/jwt');
const { UnauthorizedException } = require('@nestjs/common');

const {
  JwtAuthGuard,
} = require('../dist/auth/jwt-auth.guard.js');

const {
  createTokenOptions,
} = require('../dist/auth/token.config.js');

function createContext(authorization) {
  const request = {
    headers: authorization === undefined ? {} : { authorization },
  };

  return {
    request,
    context: {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    },
  };
}

test('JWT guard assigns the verified user identity', async () => {
  const jwt = new JwtService(
    createTokenOptions(randomBytes(32).toString('hex')),
  );

  const guard = new JwtAuthGuard(jwt);
  const userId = randomUUID();
  const token = await jwt.signAsync({ sub: userId });

  const { request, context } = createContext(`Bearer ${token}`);

  assert.equal(await guard.canActivate(context), true);
  assert.deepEqual(request.user, { id: userId });
});

test('JWT guard rejects invalid tokens without assigning identity', async () => {
  const options = createTokenOptions(
    randomBytes(32).toString('hex'),
  );

  const jwt = new JwtService(options);
  const guard = new JwtAuthGuard(jwt);
  const userId = randomUUID();

  const otherJwt = new JwtService(
    createTokenOptions(randomBytes(32).toString('hex')),
  );

  // Same secret, algorithm, issuer and audience, but no expiry.
  const jwtWithoutExpiry = new JwtService({
    ...options,
    signOptions: {
      algorithm: 'HS256',
      issuer: 'agentgate',
      audience: 'agentgate-api',
    },
  });

  const expired = await jwt.signAsync(
    { sub: userId },
    { expiresIn: -1 },
  );

  const wrongSignature = await otherJwt.signAsync({
    sub: userId,
  });

  const invalidSubject = await jwt.signAsync({
    sub: 'not-a-uuid',
  });

  const withoutExpiry = await jwtWithoutExpiry.signAsync({
    sub: userId,
  });

  // Prove the signature is valid before testing required claims.
  const payload = await jwt.verifyAsync(withoutExpiry);
  assert.equal(payload.exp, undefined);

  const invalidHeaders = [
    undefined,
    '',
    'Basic credentials',
    'Bearer',
    'Bearer invalid-token',
    `Bearer ${expired}`,
    `Bearer ${wrongSignature}`,
    `Bearer ${invalidSubject}`,
    `Bearer ${withoutExpiry}`,
  ];

  for (const header of invalidHeaders) {
    const { request, context } = createContext(header);

    await assert.rejects(
      guard.canActivate(context),
      (error) =>
        error instanceof UnauthorizedException &&
        error.getStatus() === 401,
    );

    assert.equal(request.user, undefined);
  }
});