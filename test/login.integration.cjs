require('reflect-metadata');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { ConfigService } = require('@nestjs/config');
const {
  BadRequestException,
  UnauthorizedException,
} = require('@nestjs/common');

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

test('credential validation accepts valid login and rejects invalid credentials', async () => {
  const prisma = new PrismaService(
    new ConfigService({
      DATABASE_URL: databaseUrl,
    }),
  );

  const passwords = new PasswordService();
  const auth = new AuthService(prisma, passwords);

  const email = `${randomUUID()}@example.test`;
  const missingEmail = `${randomUUID()}@example.test`;
  const password = 'a sufficiently long test passphrase';

  const isInvalidCredentials = (error) =>
    error instanceof UnauthorizedException &&
    error.getStatus() === 401 &&
    error.message === 'Invalid email or password';

  try {
    await passwords.onModuleInit();

    const registered = await auth.register({
      email,
      password,
    });

    const user = await auth.validateCredentials({
      email: ` ${email.toUpperCase()} `,
      password,
    });

    assert.deepEqual(user, {
      id: registered.id,
      email,
    });

    await assert.rejects(
      auth.validateCredentials({
        email,
        password: 'incorrect password',
      }),
      isInvalidCredentials,
    );

    await assert.rejects(
      auth.validateCredentials({
        email: missingEmail,
        password,
      }),
      isInvalidCredentials,
    );

    await assert.rejects(
      auth.validateCredentials({
        email,
        password: '',
      }),
      (error) =>
        error instanceof BadRequestException &&
        error.getStatus() === 400,
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