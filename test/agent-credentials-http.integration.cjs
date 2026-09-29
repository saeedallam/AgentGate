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

// Set configuration before loading the application.
process.env.DATABASE_URL = databaseUrl;
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.JWT_ACCESS_SECRET = randomBytes(32).toString('hex');

const { createApplication } = require('../dist/bootstrap.js');

const { AuthService } = require('../dist/auth/auth.service.js');

const {
  PrismaService,
} = require('../dist/infrastructure/database/prisma.service.js');

const {
  AgentKeyService,
} = require('../dist/agent-credentials/agent-key.service.js');

test('credential HTTP route enforces authentication and returns a non-cacheable key', async () => {
  const app = await createApplication();

  const organizationId = randomUUID();
  const agentId = randomUUID();

  const ownerEmail = `${randomUUID()}@example.test`;
  const memberEmail = `${randomUUID()}@example.test`;

  const password = 'a sufficiently long test passphrase';
  const url = `/agents/${agentId}/credentials`;

  let testFailed = false;

  try {
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    const prisma = app.get(PrismaService);
    const auth = app.get(AuthService);
    const keys = app.get(AgentKeyService);

    const owner = await auth.register({
      email: ownerEmail,
      password,
    });

    const member = await auth.register({
      email: memberEmail,
      password,
    });

    await prisma.organization.create({
      data: {
        id: organizationId,
        name: 'Credential HTTP test',
        members: {
          create: [
            {
              userId: owner.id,
              role: 'OWNER',
            },
            {
              userId: member.id,
              role: 'MEMBER',
            },
          ],
        },
      },
    });

    await prisma.agent.create({
      data: {
        id: agentId,
        organizationId,
        name: 'support-agent',
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

    const anonymous = await app.inject({
      method: 'POST',
      url,
      payload: {
        organizationId,
      },
    });

    assert.equal(anonymous.statusCode, 401);

    const invalidToken = await app.inject({
      method: 'POST',
      url,
      headers: {
        authorization: 'Bearer invalid-token',
      },
      payload: {
        organizationId,
      },
    });

    assert.equal(invalidToken.statusCode, 401);

    const forbidden = await app.inject({
      method: 'POST',
      url,
      headers: {
        authorization: `Bearer ${memberToken}`,
      },
      payload: {
        organizationId,
      },
    });

    assert.equal(forbidden.statusCode, 403);

    const spoofedIdentity = await app.inject({
      method: 'POST',
      url,
      headers: {
        authorization: `Bearer ${ownerToken}`,
      },
      payload: {
        organizationId,
        userId: member.id,
      },
    });

    assert.equal(spoofedIdentity.statusCode, 400);

    const invalidAgentId = await app.inject({
      method: 'POST',
      url: '/agents/not-a-uuid/credentials',
      headers: {
        authorization: `Bearer ${ownerToken}`,
      },
      payload: {
        organizationId,
      },
    });

    assert.equal(invalidAgentId.statusCode, 400);

    const wrongOrganization = await app.inject({
      method: 'POST',
      url,
      headers: {
        authorization: `Bearer ${ownerToken}`,
      },
      payload: {
        organizationId: randomUUID(),
      },
    });

    assert.equal(wrongOrganization.statusCode, 404);

    const created = await app.inject({
      method: 'POST',
      url,
      headers: {
        authorization: `Bearer ${ownerToken}`,
      },
      payload: {
        organizationId,
      },
    });

    assert.equal(created.statusCode, 201);
    assert.equal(created.headers['cache-control'], 'no-store');

    const body = created.json();

    assert.equal(body.agentId, agentId);
    assert.equal(body.organizationId, organizationId);
    assert.equal(typeof body.apiKey, 'string');
    assert.equal(Object.hasOwn(body, 'keyHash'), false);

    const stored = await prisma.agentCredential.findUniqueOrThrow({
      where: {
        id: body.id,
      },
    });

    assert.equal(keys.verify(body.apiKey, stored.keyHash), true);

    assert.equal(keys.getPrefix(body.apiKey), stored.keyPrefix);

    assert.equal(
      stored.keyHash === body.apiKey,
      false,
      'The database must not store the plaintext API key'
    );

    await prisma.agent.update({
      where: {
        id: agentId,
      },
      data: {
        status: 'SUSPENDED',
      },
    });

    const suspended = await app.inject({
      method: 'POST',
      url,
      headers: {
        authorization: `Bearer ${ownerToken}`,
      },
      payload: {
        organizationId,
      },
    });

    assert.equal(suspended.statusCode, 409);

    const count = await prisma.agentCredential.count({
      where: {
        organizationId,
        agentId,
      },
    });

    assert.equal(count, 1);
  } catch (error) {
    testFailed = true;
    throw error;
  } finally {
    try {
      const prisma = app.get(PrismaService);

      await prisma.$transaction([
        prisma.agentCredential.deleteMany({
          where: {
            organizationId,
          },
        }),

        prisma.agent.deleteMany({
          where: {
            organizationId,
          },
        }),

        prisma.organizationMember.deleteMany({
          where: {
            organizationId,
          },
        }),

        prisma.organization.deleteMany({
          where: {
            id: organizationId,
          },
        }),

        prisma.user.deleteMany({
          where: {
            email: {
              in: [ownerEmail, memberEmail],
            },
          },
        }),
      ]);
    } catch (cleanupError) {
      if (!testFailed) {
        throw cleanupError;
      }

      console.error('Test cleanup also failed:', cleanupError);
    } finally {
      await app.close();
    }
  }
});
