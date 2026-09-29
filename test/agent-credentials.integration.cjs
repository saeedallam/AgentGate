require('reflect-metadata');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { ConfigService } = require('@nestjs/config');

const {
  PrismaService,
} = require('../dist/infrastructure/database/prisma.service.js');

const {
  AgentKeyService,
} = require('../dist/agent-credentials/agent-key.service.js');

const {
  AgentCredentialsService,
} = require('../dist/agent-credentials/agent-credentials.service.js');

const databaseUrl = process.env.TEST_DATABASE_URL;

if (!databaseUrl) {
  throw new Error('TEST_DATABASE_URL is required');
}

if (new URL(databaseUrl).pathname !== '/agentgate_test') {
  throw new Error('Integration tests require agentgate_test');
}

test('credential issuance stores only a hash and enforces tenant ownership', async () => {
  const prisma = new PrismaService(
    new ConfigService({
      DATABASE_URL: databaseUrl,
    })
  );

  const keys = new AgentKeyService();
  const credentials = new AgentCredentialsService(prisma, keys);

  const ownerId = randomUUID();
  const memberId = randomUUID();

  const organizationId = randomUUID();
  const otherOrganizationId = randomUUID();

  const agentId = randomUUID();
  const otherAgentId = randomUUID();

  const organizationIds = [organizationId, otherOrganizationId];

  const userIds = [ownerId, memberId];

  let testFailed = false;

  try {
    // Arrange: create users without exercising login.
    await prisma.user.createMany({
      data: userIds.map((id) => ({
        id,
        email: `${id}@example.test`,
        passwordHash: 'unused-in-this-service-test',
      })),
    });

    await prisma.organization.createMany({
      data: [
        {
          id: organizationId,
          name: 'Credential test organization',
        },
        {
          id: otherOrganizationId,
          name: 'Other credential test organization',
        },
      ],
    });

    await prisma.organizationMember.createMany({
      data: [
        {
          organizationId,
          userId: ownerId,
          role: 'OWNER',
        },
        {
          organizationId,
          userId: memberId,
          role: 'MEMBER',
        },
      ],
    });

    await prisma.agent.createMany({
      data: [
        {
          id: agentId,
          organizationId,
          name: 'support-agent',
        },
        {
          id: otherAgentId,
          organizationId: otherOrganizationId,
          name: 'support-agent',
        },
      ],
    });

    const target = {
      organizationId,
      agentId,
    };

    // OWNER can issue a credential.
    const issued = await credentials.createForUser(ownerId, target);

    assert.equal(issued.organizationId, organizationId);
    assert.equal(issued.agentId, agentId);

    assert.equal(
      Object.hasOwn(issued, 'keyHash'),
      false,
      'The response must not expose the stored hash'
    );

    assert.equal(keys.getPrefix(issued.apiKey), issued.keyPrefix);

    const stored = await prisma.agentCredential.findUniqueOrThrow({
      where: {
        id: issued.id,
      },
    });

    assert.equal(stored.organizationId, organizationId);
    assert.equal(stored.agentId, agentId);
    assert.equal(stored.keyPrefix, issued.keyPrefix);

    assert.equal(Object.hasOwn(stored, 'apiKey'), false);
    assert.equal(Object.hasOwn(stored, 'secret'), false);

    // Compare as a boolean to avoid printing the key on failure.
    assert.equal(
      stored.keyHash === issued.apiKey,
      false,
      'The database must not store the plaintext API key'
    );

    assert.equal(
      keys.verify(issued.apiKey, stored.keyHash),
      true,
      'The stored hash must verify the issued API key'
    );

    assert.equal(stored.revokedAt, null);

    // MEMBER cannot issue credentials.
    await assert.rejects(() => credentials.createForUser(memberId, target), {
      status: 403,
    });

    // Ownership in one organization grants no access to another.
    await assert.rejects(
      () =>
        credentials.createForUser(ownerId, {
          organizationId: otherOrganizationId,
          agentId: otherAgentId,
        }),
      {
        status: 404,
      }
    );

    // An agent cannot be paired with the wrong organization.
    await assert.rejects(
      () =>
        credentials.createForUser(ownerId, {
          organizationId,
          agentId: otherAgentId,
        }),
      {
        status: 404,
      }
    );

    // Database constraints also reject mismatched tenant ownership.
    const mismatchedKey = keys.generate();

    await assert.rejects(
      () =>
        prisma.agentCredential.create({
          data: {
            organizationId,
            agentId: otherAgentId,
            keyPrefix: mismatchedKey.keyPrefix,
            keyHash: mismatchedKey.keyHash,
          },
        }),
      {
        code: 'P2003',
      }
    );

    // Suspended agents cannot receive new credentials.
    await prisma.agent.update({
      where: {
        id: agentId,
      },
      data: {
        status: 'SUSPENDED',
      },
    });

    await assert.rejects(() => credentials.createForUser(ownerId, target), {
      status: 409,
    });

    // Rejected requests must not create additional credentials.
    const count = await prisma.agentCredential.count({
      where: {
        organizationId: {
          in: organizationIds,
        },
      },
    });

    assert.equal(count, 1);
  } catch (error) {
    testFailed = true;
    throw error;
  } finally {
    try {
      // Delete dependent records before their parents.
      // A transaction keeps cleanup atomic.
      await prisma.$transaction([
        prisma.agentCredential.deleteMany({
          where: {
            organizationId: {
              in: organizationIds,
            },
          },
        }),

        prisma.agent.deleteMany({
          where: {
            organizationId: {
              in: organizationIds,
            },
          },
        }),

        prisma.organizationMember.deleteMany({
          where: {
            organizationId: {
              in: organizationIds,
            },
          },
        }),

        prisma.organization.deleteMany({
          where: {
            id: {
              in: organizationIds,
            },
          },
        }),

        prisma.user.deleteMany({
          where: {
            id: {
              in: userIds,
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
      await prisma.$disconnect();
    }
  }
});
