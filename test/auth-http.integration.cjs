require('reflect-metadata');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const databaseUrl = process.env.TEST_DATABASE_URL;

if (!databaseUrl) {
  throw new Error('TEST_DATABASE_URL is required');
}

if (new URL(databaseUrl).pathname !== '/agentgate_test') {
  throw new Error('HTTP tests require the agentgate_test database');
}

// Configure the test database before loading the application.
process.env.DATABASE_URL = databaseUrl;
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

const { createApplication } = require('../dist/bootstrap.js');

const {
  PrismaService,
} = require('../dist/infrastructure/database/prisma.service.js');

test('registration HTTP responses and rate limit', async () => {
  const app = await createApplication();

  const email = `${randomUUID()}@example.test`;
  const blockedEmail = `${randomUUID()}@example.test`;
  const password = 'a sufficiently long test passphrase';

  try {
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    const prisma = app.get(PrismaService);

    const register = (payload) =>
      app.inject({
        method: 'POST',
        url: '/auth/register',
        remoteAddress: '127.0.0.1',
        payload,
      });

    // Request 1: successful registration.
    const created = await register({
      email,
      password,
    });

    assert.equal(created.statusCode, 201);
    assert.equal(created.json().email, email);

    assert.deepEqual(
      Object.keys(created.json()).sort(),
      ['createdAt', 'email', 'id'],
    );

    // Request 2: unexpected fields are rejected.
    const invalid = await register({
      email: blockedEmail,
      password,
      role: 'OWNER',
    });

    assert.equal(invalid.statusCode, 400);

    // Request 3: normalized duplicate email.
    const duplicate = await register({
      email: ` ${email.toUpperCase()} `,
      password,
    });

    assert.equal(duplicate.statusCode, 409);
    assert.equal(duplicate.body.includes(password), false);

    // Requests 4 and 5: invalid requests also consume the limit.
    for (let index = 0; index < 2; index += 1) {
      const response = await register({});

      assert.equal(response.statusCode, 400);
    }

    // Request 6: valid input, but the rate limit blocks it.
    const blocked = await register({
      email: blockedEmail,
      password,
    });

    assert.equal(blocked.statusCode, 429);

    // Neither the invalid nor the blocked request created this user.
    assert.equal(
      await prisma.user.count({
        where: { email: blockedEmail },
      }),
      0,
    );

    // The duplicate request did not create a second user.
    assert.equal(
      await prisma.user.count({
        where: { email },
      }),
      1,
    );
  } finally {
    try {
      const prisma = app.get(PrismaService);

      // Delete only records belonging to this test.
      await prisma.user.deleteMany({
        where: {
          email: {
            in: [email, blockedEmail],
          },
        },
      });
    } finally {
      await app.close();
    }
  }
});