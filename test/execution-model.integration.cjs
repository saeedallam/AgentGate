require('reflect-metadata');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { ConfigService } = require('@nestjs/config');

const {
  PrismaService,
} = require('../dist/infrastructure/database/prisma.service.js');

const databaseUrl = process.env.TEST_DATABASE_URL;

if (!databaseUrl) {
  throw new Error('TEST_DATABASE_URL is required');
}

if (new URL(databaseUrl).pathname !== '/agentgate_test') {
  throw new Error('Execution tests require agentgate_test');
}

test('execution model stores requests and enforces the agent tenant relationship', async () => {
  const prisma = new PrismaService(
    new ConfigService({
      DATABASE_URL: databaseUrl,
    })
  );

  const organizationA = randomUUID();
  const organizationB = randomUUID();
  const agentA = randomUUID();
  const agentB = randomUUID();

  const organizationIds = [organizationA, organizationB];

  const requestedAt = new Date('2026-10-02T06:00:00.000Z');

  const actionData = {
    actionName: 'refund.create',
    arguments: {
      paymentId: 'payment_123',
      amountMinor: 5000,
      currency: 'USD',
    },
    resourceType: 'payment',
    resourceId: 'payment_123',
    environment: 'development',
    requestedAt,
  };

  let testFailed = false;

  try {
    await prisma.organization.createMany({
      data: [
        {
          id: organizationA,
          name: 'Execution test A',
        },
        {
          id: organizationB,
          name: 'Execution test B',
        },
      ],
    });

    await prisma.agent.createMany({
      data: [
        {
          id: agentA,
          organizationId: organizationA,
          name: 'test-agent',
        },
        {
          id: agentB,
          organizationId: organizationB,
          name: 'test-agent',
        },
      ],
    });

    const created = await prisma.execution.create({
      data: {
        ...actionData,
        organizationId: organizationA,
        agentId: agentA,
      },
    });

    // Read the stored record back from PostgreSQL.
    const stored = await prisma.execution.findUniqueOrThrow({
      where: {
        id: created.id,
      },
    });

    assert.equal(stored.organizationId, organizationA);
    assert.equal(stored.agentId, agentA);
    assert.equal(stored.status, 'RECEIVED');
    assert.equal(stored.actionName, actionData.actionName);
    assert.deepEqual(stored.arguments, actionData.arguments);
    assert.equal(stored.resourceType, 'payment');
    assert.equal(stored.resourceId, 'payment_123');
    assert.equal(stored.environment, 'development');
    assert.equal(stored.requestedAt.getTime(), requestedAt.getTime());
    assert.equal(stored.result, null);
    assert.equal(stored.errorCode, null);

    // Both IDs exist, but they do not belong together.
    await assert.rejects(
      () =>
        prisma.execution.create({
          data: {
            ...actionData,
            organizationId: organizationA,
            agentId: agentB,
          },
        }),
      {
        code: 'P2003',
      }
    );

    // The rejected insert must not leave a record behind.
    const executionCount = await prisma.execution.count({
      where: {
        organizationId: {
          in: organizationIds,
        },
      },
    });

    assert.equal(executionCount, 1);

    // Existing execution history prevents deleting its agent.
    await assert.rejects(
      () =>
        prisma.agent.delete({
          where: {
            id: agentA,
          },
        }),
      {
        code: 'P2003',
      }
    );

    const retainedAgent = await prisma.agent.findUnique({
      where: {
        id: agentA,
      },
    });

    assert.notEqual(retainedAgent, null);
  } catch (error) {
    testFailed = true;
    throw error;
  } finally {
    try {
      await prisma.$transaction([
        prisma.execution.deleteMany({
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

        prisma.organization.deleteMany({
          where: {
            id: {
              in: organizationIds,
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
