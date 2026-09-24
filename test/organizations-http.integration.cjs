require('reflect-metadata');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');

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
const { AuthService } = require('../dist/auth/auth.service.js');
const {
  PrismaService,
} = require('../dist/infrastructure/database/prisma.service.js');

test('organization HTTP routes enforce authentication and tenant membership', async () => {
  const app = await createApplication();

  const emails = [
    `${randomUUID()}@example.test`,
    `${randomUUID()}@example.test`,
  ];

  const names = [
    `organization-a-${randomUUID()}`,
    `organization-b-${randomUUID()}`,
  ];

  const password = 'a sufficiently long test passphrase';

  try {
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    const prisma = app.get(PrismaService);
    const auth = app.get(AuthService);

    const userA = await auth.register({
      email: emails[0],
      password,
    });

    await auth.register({
      email: emails[1],
      password,
    });

    async function login(email) {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email, password },
      });

      assert.equal(response.statusCode, 200);

      return response.json().accessToken;
    }

    const tokenA = await login(emails[0]);
    const tokenB = await login(emails[1]);

    const headersA = {
      authorization: `Bearer ${tokenA}`,
    };

    const headersB = {
      authorization: `Bearer ${tokenB}`,
    };

    // Creation requires authentication.
    const unauthenticated = await app.inject({
      method: 'POST',
      url: '/organizations',
      payload: { name: names[0] },
    });

    assert.equal(unauthenticated.statusCode, 401);

    // The caller cannot supply an owner or role.
    const injectedOwner = await app.inject({
      method: 'POST',
      url: '/organizations',
      headers: headersA,
      payload: {
        name: names[0],
        userId: randomUUID(),
        role: 'OWNER',
      },
    });

    assert.equal(injectedOwner.statusCode, 400);

    const createdA = await app.inject({
      method: 'POST',
      url: '/organizations',
      headers: headersA,
      payload: { name: names[0] },
    });

    const createdB = await app.inject({
      method: 'POST',
      url: '/organizations',
      headers: headersB,
      payload: { name: names[1] },
    });

    assert.equal(createdA.statusCode, 201);
    assert.equal(createdB.statusCode, 201);

    const organizationA = createdA.json();
    const organizationB = createdB.json();

    const owner = await prisma.organizationMember.findUniqueOrThrow({
      where: {
        organizationId_userId: {
          organizationId: organizationA.id,
          userId: userA.id,
        },
      },
    });

    assert.equal(owner.role, 'OWNER');

    // Each user can read their own organization.
    for (const [headers, id] of [
      [headersA, organizationA.id],
      [headersB, organizationB.id],
    ]) {
      const response = await app.inject({
        method: 'GET',
        url: `/organizations/${id}`,
        headers,
      });

      assert.equal(response.statusCode, 200);
      assert.equal(response.json().id, id);
    }

    // Both directions of cross-tenant access are denied.
    const crossTenantA = await app.inject({
      method: 'GET',
      url: `/organizations/${organizationB.id}`,
      headers: headersA,
    });

    const crossTenantB = await app.inject({
      method: 'GET',
      url: `/organizations/${organizationA.id}`,
      headers: headersB,
    });

    assert.equal(crossTenantA.statusCode, 404);
    assert.equal(crossTenantB.statusCode, 404);

    const missing = await app.inject({
      method: 'GET',
      url: `/organizations/${randomUUID()}`,
      headers: headersA,
    });

    assert.equal(missing.statusCode, 404);
    assert.deepEqual(missing.json(), crossTenantA.json());

    // A real organization still requires a valid token.
    for (const headers of [
      {},
      { authorization: 'Bearer invalid-token' },
    ]) {
      const response = await app.inject({
        method: 'GET',
        url: `/organizations/${organizationA.id}`,
        headers,
      });

      assert.equal(response.statusCode, 401);
    }

    const invalidId = await app.inject({
      method: 'GET',
      url: '/organizations/not-a-uuid',
      headers: headersA,
    });

    assert.equal(invalidId.statusCode, 400);
  } finally {
    try {
      const prisma = app.get(PrismaService);

      await prisma.organizationMember.deleteMany({
        where: {
          organization: {
            name: { in: names },
          },
        },
      });

      await prisma.organization.deleteMany({
        where: {
          name: { in: names },
        },
      });

      await prisma.user.deleteMany({
        where: {
          email: { in: emails },
        },
      });
    } finally {
      await app.close();
    }
  }
});