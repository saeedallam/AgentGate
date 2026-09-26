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

test('agent HTTP creation uses the authenticated identity and enforces role', async () => {
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

    // Arrange: one OWNER and one MEMBER in the same organization.
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
      `test-${randomUUID()}`,
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
        payload: { email, password },
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
        headers: token
          ? { authorization: `Bearer ${token}` }
          : {},
        payload,
      });

    // Missing or invalid authentication.
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
      'invalid-token',
    );

    assert.equal(invalidToken.statusCode, 401);

    // The request body cannot override the authenticated identity.
    const spoofedOwner = await createAgent(
      {
        organizationId,
        name: 'spoofed-owner-agent',
        userId: owner.id,
      },
      memberToken,
    );

    assert.equal(spoofedOwner.statusCode, 400);

    // Valid input still does not grant a MEMBER permission.
    const forbidden = await createAgent(
      {
        organizationId,
        name: 'member-agent',
      },
      memberToken,
    );

    assert.equal(forbidden.statusCode, 403);

    // All rejected requests must leave no agents behind.
    assert.equal(
      await prisma.agent.count({
        where: { organizationId },
      }),
      0,
    );

    // OWNER creation succeeds.
    const created = await createAgent(
      {
        organizationId,
        name: 'support-agent',
      },
      ownerToken,
    );

    assert.equal(created.statusCode, 201);

    const body = created.json();

    assert.equal(body.organizationId, organizationId);
    assert.equal(body.name, 'support-agent');
    assert.equal(body.status, 'ACTIVE');

    assert.deepEqual(
      Object.keys(body).sort(),
      ['createdAt', 'id', 'name', 'organizationId', 'status'],
    );

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
      1,
    );
  } finally {
    try {
      const prisma = app.get(PrismaService);

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