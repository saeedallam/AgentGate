const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:1/test';

const { validateEnvironment } = require('../dist/infrastructure/config/environment.js');
const { createApplication } = require('../dist/bootstrap.js');
const { PrismaService } = require('../dist/infrastructure/database/prisma.service.js');

test('config rejects invalid ports and non-Postgres URLs without exposing values', () => {
  assert.throws(() => validateEnvironment({ DATABASE_URL: 'secret-password', PORT: 70000 }),
    (error) => error.message.includes('DATABASE_URL') && !error.message.includes('secret-password'));
  assert.throws(() => validateEnvironment({ DATABASE_URL: 'https://example.com' }));
  assert.equal(validateEnvironment({ DATABASE_URL: process.env.DATABASE_URL }).PORT, 3000);
});

test('Fastify health endpoints handle database success and failure', async () => {
  const app = await createApplication();
  try {
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    const live = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(live.statusCode, 200);
    assert.deepEqual(live.json(), { status: 'ok' });

    const prisma = app.get(PrismaService);
    prisma.$queryRaw = async () => [{ result: 1 }];
    const ready = await app.inject({ method: 'GET', url: '/health/ready' });
    assert.equal(ready.statusCode, 200);

    prisma.$queryRaw = async () => { throw new Error('database-password-private'); };
    const unavailable = await app.inject({ method: 'GET', url: '/health/ready' });
    assert.equal(unavailable.statusCode, 503);
    assert.equal(unavailable.body.includes('database-password-private'), false);
    assert.equal((await app.inject({ method: 'GET', url: '/health' })).statusCode, 200);
  } finally {
    await app.close();
  }
});
