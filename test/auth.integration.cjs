require('reflect-metadata');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { ConfigService } = require('@nestjs/config');
const { ConflictException } = require('@nestjs/common');

const {
  PrismaService,
} = require('../dist/infrastructure/database/prisma.service.js');

const {
  AuthService,
} = require('../dist/auth/auth.service.js');

const {
  PasswordService,
} = require('../dist/auth/password.service.js');

const databaseUrl = process.env.TEST_DATABASE_URL;

if (!databaseUrl) {
  throw new Error('TEST_DATABASE_URL is required');
}

if (new URL(databaseUrl).pathname !== '/agentgate_test') {
  throw new Error('Integration tests require the agentgate_test database');
}

test('registration stores a hash and rejects concurrent duplicate emails', async () => {
  const prisma = new PrismaService(
    new ConfigService({
      DATABASE_URL: databaseUrl,
    }),
  );

  const passwords = new PasswordService();
  const auth = new AuthService(prisma, passwords);

  const email = `${randomUUID()}@example.test`;
  const password = 'a sufficiently long test passphrase';

  try {
    const results = await Promise.allSettled([
      auth.register({ email, password }),
      auth.register({
        email: `  ${email.toUpperCase()}  `,
        password,
      }),
    ]);

    const succeeded = results.filter(
      (result) => result.status === 'fulfilled',
    );

    const rejected = results.filter(
      (result) => result.status === 'rejected',
    );

    assert.equal(succeeded.length, 1);
    assert.equal(rejected.length, 1);
    assert.ok(rejected[0].reason instanceof ConflictException);

    const returnedUser = succeeded[0].value;

    assert.equal(returnedUser.email, email);
    assert.deepEqual(
      Object.keys(returnedUser).sort(),
      ['createdAt', 'email', 'id'],
    );

    const storedUsers = await prisma.user.findMany({
      where: { email },
    });

    assert.equal(storedUsers.length, 1);

    const storedUser = storedUsers[0];

    assert.notEqual(storedUser.passwordHash, password);
    assert.match(storedUser.passwordHash, /^\$argon2id\$/);
    assert.equal(
      await passwords.verify(storedUser.passwordHash, password),
      true,
    );
  } finally {
    try {
      await prisma.user.deleteMany({
        where: { email },
      });
    } finally {
      await prisma.$disconnect();
    }
  }
});