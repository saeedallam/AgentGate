require('reflect-metadata');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');

const databaseUrl = process.env.TEST_DATABASE_URL;

if (!databaseUrl) {
  throw new Error('TEST_DATABASE_URL is required');
}

if (new URL(databaseUrl).pathname !== '/agentgate_test') {
  throw new Error('HTTP tests require agentgate_test');
}

// Configure the environment before loading the application.
process.env.DATABASE_URL = databaseUrl;
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.JWT_ACCESS_SECRET = randomBytes(32).toString('hex');

const { createApplication } = require('../dist/bootstrap.js');

const { AuthService } = require('../dist/auth/auth.service.js');

const {
  OrganizationsService,
} = require('../dist/organizations/organizations.service.js');

const {
  PrismaService,
} = require('../dist/infrastructure/database/prisma.service.js');

test('agent HTTP routes enforce creation roles and scoped reads', async () => {
  const app = await createApplication();

  const ownerEmail = `${randomUUID()}@example.test`;
  const memberEmail = `${randomUUID()}@example.test`;
  const password = 'a sufficiently long test passphrase';

  let organizationId;

  try {
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    const prisma = app.get(PrismaService);
    const auth = app.get(AuthService);
    const organizations = app.get(OrganizationsService);

    // 1. Prepare an OWNER and a MEMBER in the same organization.
    const owner = await auth.register({
      email: ownerEmail,
      password,
    });

    const member = await auth.register({
      email: memberEmail,
      password,
    });

    const organization = await organizations.createForUser(
      owner.id,
      `test-${randomUUID()}`
    );

    organizationId = organization.id;

    await prisma.organizationMember.create({
      data: {
        organizationId,
        userId: member.id,
        role: 'MEMBER',
      },
    });

    async function login(email) {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          email,
          password,
        },
      });

      assert.equal(response.statusCode, 200);

      return response.json().accessToken;
    }

    const ownerToken = await login(ownerEmail);
    const memberToken = await login(memberEmail);

    const createAgent = (payload, token) =>
      app.inject({
        method: 'POST',
        url: '/agents',
        headers: token ? { authorization: `Bearer ${token}` } : {},
        payload,
      });

    // 2. Reject creation without valid authentication.
    const unauthenticated = await createAgent({
      organizationId,
      name: 'unauthenticated-agent',
    });

    assert.equal(unauthenticated.statusCode, 401);

    const invalidToken = await createAgent(
      {
        organizationId,
        name: 'invalid-token-agent',
      },
      'invalid-token'
    );

    assert.equal(invalidToken.statusCode, 401);

    // 3. The body cannot override the authenticated identity.
    const spoofedOwner = await createAgent(
      {
        organizationId,
        name: 'spoofed-owner-agent',
        userId: owner.id,
      },
      memberToken
    );

    assert.equal(spoofedOwner.statusCode, 400);

    // 4. A MEMBER cannot create an agent.
    const forbidden = await createAgent(
      {
        organizationId,
        name: 'member-agent',
      },
      memberToken
    );

    assert.equal(forbidden.statusCode, 403);

    // Rejected requests must not create database records.
    assert.equal(
      await prisma.agent.count({
        where: { organizationId },
      }),
      0
    );

    // 5. An OWNER can create an agent.
    const created = await createAgent(
      {
        organizationId,
        name: 'support-agent',
      },
      ownerToken
    );

    assert.equal(created.statusCode, 201);

    const body = created.json();

    assert.equal(body.organizationId, organizationId);
    assert.equal(body.name, 'support-agent');
    assert.equal(body.status, 'ACTIVE');

    assert.deepEqual(Object.keys(body).sort(), [
      'createdAt',
      'id',
      'name',
      'organizationId',
      'status',
    ]);

    const storedAgent = await prisma.agent.findFirst({
      where: {
        id: body.id,
        organizationId,
      },
    });

    assert.ok(storedAgent);
    assert.equal(storedAgent.name, 'support-agent');
    assert.equal(storedAgent.status, 'ACTIVE');

    assert.equal(
      await prisma.agent.count({
        where: { organizationId },
      }),
      1
    );

    // 6. Both OWNER and MEMBER can read the agent.
    const agentUrl = `/agents/${body.id}?organizationId=${organizationId}`;

    for (const token of [ownerToken, memberToken]) {
      const response = await app.inject({
        method: 'GET',
        url: agentUrl,
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      assert.equal(response.statusCode, 200);
      assert.equal(response.json().id, body.id);
      assert.equal(response.json().organizationId, organizationId);

      assert.deepEqual(Object.keys(response.json()).sort(), [
        'createdAt',
        'id',
        'name',
        'organizationId',
        'status',
        'updatedAt',
      ]);
    }

    // 7. Reading also requires authentication.
    const unauthenticatedRead = await app.inject({
      method: 'GET',
      url: agentUrl,
    });

    assert.equal(unauthenticatedRead.statusCode, 401);

    // 8. An agent ID does not bypass organization scope.
    const wrongOrganization = await app.inject({
      method: 'GET',
      url: `/agents/${body.id}` + `?organizationId=${randomUUID()}`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
      },
    });

    assert.equal(wrongOrganization.statusCode, 404);

    // 9. Missing agents return the same error.
    const missingAgent = await app.inject({
      method: 'GET',
      url: `/agents/${randomUUID()}` + `?organizationId=${organizationId}`,
      headers: {
        authorization: `Bearer ${ownerToken}`,
      },
    });

    assert.equal(missingAgent.statusCode, 404);

    assert.deepEqual(missingAgent.json(), wrongOrganization.json());

    // 10. Reject malformed or missing identifiers.
    const invalidUrls = [
      `/agents/not-a-uuid?organizationId=${organizationId}`,
      `/agents/${body.id}?organizationId=not-a-uuid`,
      `/agents/${body.id}`,
    ];

    for (const url of invalidUrls) {
      const response = await app.inject({
        method: 'GET',
        url,
        headers: {
          authorization: `Bearer ${ownerToken}`,
        },
      });

      assert.equal(response.statusCode, 400);
    }
  } finally {
    try {
      const prisma = app.get(PrismaService);

      // Remove only this test's data in foreign-key order.
      if (organizationId) {
        await prisma.agent.deleteMany({
          where: { organizationId },
        });

        await prisma.organizationMember.deleteMany({
          where: { organizationId },
        });

        await prisma.organization.delete({
          where: { id: organizationId },
        });
      }

      await prisma.user.deleteMany({
        where: {
          email: {
            in: [ownerEmail, memberEmail],
          },
        },
      });
    } finally {
      await app.close();
    }
  }
});
