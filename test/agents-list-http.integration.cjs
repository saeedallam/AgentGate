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

test('agent list enforces membership and paginates tenant data', async () => {
  const app = await createApplication();

  const ownerEmail = `${randomUUID()}@example.test`;
  const memberEmail = `${randomUUID()}@example.test`;
  const password = 'a sufficiently long test passphrase';

  const organizationIds = [];

  try {
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    const prisma = app.get(PrismaService);
    const auth = app.get(AuthService);
    const organizations = app.get(OrganizationsService);

    const owner = await auth.register({
      email: ownerEmail,
      password,
    });

    const member = await auth.register({
      email: memberEmail,
      password,
    });

    const populated = await organizations.createForUser(
      owner.id,
      `populated-${randomUUID()}`
    );

    organizationIds.push(populated.id);

    const empty = await organizations.createForUser(
      owner.id,
      `empty-${randomUUID()}`
    );

    organizationIds.push(empty.id);

    // MEMBER belongs only to the populated organization.
    await prisma.organizationMember.create({
      data: {
        organizationId: populated.id,
        userId: member.id,
        role: 'MEMBER',
      },
    });

    // Fixed timestamps make ordering predictable.
    const agentIds = [randomUUID(), randomUUID(), randomUUID()];

    await prisma.agent.createMany({
      data: agentIds.map((id, index) => ({
        id,
        organizationId: populated.id,
        name: `agent-${index}`,
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)),
      })),
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

    const list = (organizationId, token, query = '') =>
      app.inject({
        method: 'GET',
        url: `/agents?organizationId=${organizationId}` + query,
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });

    // Authentication is required.
    const unauthenticated = await list(populated.id);

    assert.equal(unauthenticated.statusCode, 401);

    // First page: newest two agents.
    const firstPage = await list(
      populated.id,
      memberToken,
      '&limit=2&offset=0'
    );

    assert.equal(firstPage.statusCode, 200);

    const first = firstPage.json();

    assert.equal(first.limit, 2);
    assert.equal(first.offset, 0);
    assert.equal(first.hasMore, true);

    assert.deepEqual(
      first.items.map((agent) => agent.id),
      [agentIds[2], agentIds[1]]
    );

    for (const agent of first.items) {
      assert.equal(agent.organizationId, populated.id);
    }

    // Second page: the remaining agent.
    const secondPage = await list(
      populated.id,
      memberToken,
      '&limit=2&offset=2'
    );

    assert.equal(secondPage.statusCode, 200);

    const second = secondPage.json();

    assert.equal(second.hasMore, false);
    assert.equal(second.offset, 2);

    assert.deepEqual(
      second.items.map((agent) => agent.id),
      [agentIds[0]]
    );

    const allReturnedIds = [...first.items, ...second.items].map(
      (agent) => agent.id
    );

    assert.equal(new Set(allReturnedIds).size, 3);

    // Default pagination.
    const defaults = await list(populated.id, ownerToken);

    assert.equal(defaults.statusCode, 200);
    assert.equal(defaults.json().limit, 20);
    assert.equal(defaults.json().offset, 0);
    assert.equal(defaults.json().items.length, 3);
    assert.equal(defaults.json().hasMore, false);

    // An authorized empty organization returns an empty list.
    const emptyResponse = await list(empty.id, ownerToken);

    assert.equal(emptyResponse.statusCode, 200);

    assert.deepEqual(emptyResponse.json(), {
      items: [],
      limit: 20,
      offset: 0,
      hasMore: false,
    });

    // A nonmember cannot access even an empty organization.
    const forbiddenEmpty = await list(empty.id, memberToken);

    assert.equal(forbiddenEmpty.statusCode, 404);

    // Adding an agent must not change that authorization result.
    await prisma.agent.create({
      data: {
        organizationId: empty.id,
        name: 'private-agent',
      },
    });

    const forbiddenPopulated = await list(empty.id, memberToken);

    assert.equal(forbiddenPopulated.statusCode, 404);

    assert.deepEqual(forbiddenPopulated.json(), forbiddenEmpty.json());

    // The private agent must not leak into the accessible list.
    const scopedList = await list(populated.id, memberToken);

    assert.equal(scopedList.statusCode, 200);
    assert.equal(scopedList.json().items.length, 3);

    for (const agent of scopedList.json().items) {
      assert.equal(agent.organizationId, populated.id);
    }

    // Offset beyond the last record is valid but empty.
    const beyond = await list(populated.id, memberToken, '&limit=2&offset=10');

    assert.equal(beyond.statusCode, 200);
    assert.deepEqual(beyond.json().items, []);
    assert.equal(beyond.json().hasMore, false);

    // Invalid pagination values.
    for (const query of [
      '&limit=0',
      '&limit=101',
      '&limit=',
      '&limit=abc',
      '&offset=-1',
      '&offset=1.5',
    ]) {
      const invalid = await list(populated.id, memberToken, query);

      assert.equal(
        invalid.statusCode,
        400,
        `Expected rejection for query: ${query}`
      );
    }
  } catch (error) {
    // Temporary diagnostics: show the failure before cleanup runs.
    console.error('Original test failure:', error);

    if (error && typeof error === 'object') {
      console.error('Database error details:', {
        code: error.code,
        meta: error.meta,
        cause: error.cause,
      });
    }

    throw error;
  } finally {
    try {
      const prisma = app.get(PrismaService);

      await prisma.agent.deleteMany({
        where: {
          organizationId: {
            in: organizationIds,
          },
        },
      });

      await prisma.organizationMember.deleteMany({
        where: {
          organizationId: {
            in: organizationIds,
          },
        },
      });

      await prisma.organization.deleteMany({
        where: {
          id: {
            in: organizationIds,
          },
        },
      });

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
