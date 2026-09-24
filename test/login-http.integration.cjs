require('reflect-metadata');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const { JwtService } = require('@nestjs/jwt');

const databaseUrl = process.env.TEST_DATABASE_URL;

if (!databaseUrl) {
  throw new Error('TEST_DATABASE_URL is required');
}

if (new URL(databaseUrl).pathname !== '/agentgate_test') {
  throw new Error('HTTP tests require the agentgate_test database');
}

process.env.DATABASE_URL = databaseUrl;
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.JWT_ACCESS_SECRET = randomBytes(32).toString('hex');

const { createApplication } = require('../dist/bootstrap.js');
const {
  PrismaService,
} = require('../dist/infrastructure/database/prisma.service.js');
const { AuthService } = require('../dist/auth/auth.service.js');
const {
  createTokenOptions,
} = require('../dist/auth/token.config.js');

test('login HTTP issues a token and rejects invalid or excessive attempts', async () => {
  const app = await createApplication();

  const email = `${randomUUID()}@example.test`;
  const password = 'a sufficiently long test passphrase';

  try {
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    const registered = await app.get(AuthService).register({
      email,
      password,
    });

    const login = (payload) =>
      app.inject({
        method: 'POST',
        url: '/auth/login',
        remoteAddress: '127.0.0.1',
        payload,
      });

    // Request 1: valid credentials.
    const success = await login({
      email: ` ${email.toUpperCase()} `,
      password,
    });

    assert.equal(success.statusCode, 200);
    assert.equal(success.headers['cache-control'], 'no-store');

    const body = success.json();

    assert.deepEqual(
      Object.keys(body).sort(),
      ['accessToken', 'expiresIn', 'tokenType'],
    );
    assert.equal(body.tokenType, 'Bearer');
    assert.equal(body.expiresIn, 900);

    const verifier = new JwtService(
      createTokenOptions(process.env.JWT_ACCESS_SECRET),
    );

    const claims = await verifier.verifyAsync(body.accessToken);
    assert.equal(claims.sub, registered.id);

    // Requests 2 and 3: identical failure responses.
    const wrongPassword = await login({
      email,
      password: 'incorrect password',
    });

    const missingUser = await login({
      email: `${randomUUID()}@example.test`,
      password,
    });

    assert.equal(wrongPassword.statusCode, 401);
    assert.equal(missingUser.statusCode, 401);
    assert.deepEqual(wrongPassword.json(), missingUser.json());
    assert.equal('accessToken' in wrongPassword.json(), false);

    // Requests 4 and 5: invalid input.
    for (let index = 0; index < 2; index += 1) {
      const invalid = await login({});
      assert.equal(invalid.statusCode, 400);
    }

    // Request 6: valid credentials, but blocked by rate limiting.
    const blocked = await login({ email, password });

    assert.equal(blocked.statusCode, 429);
    assert.equal('accessToken' in blocked.json(), false);
  } finally {
    try {
      await app.get(PrismaService).user.deleteMany({
        where: { email },
      });
    } finally {
      await app.close();
    }
  }
});