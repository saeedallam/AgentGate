require('reflect-metadata');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { ConfigService } = require('@nestjs/config');
const { ForbiddenException } = require('@nestjs/common');

const {
  PrismaService,
} = require('../dist/infrastructure/database/prisma.service.js');

const {
  OrganizationsService,
} = require('../dist/organizations/organizations.service.js');

const {
  AgentsService,
} = require('../dist/agents/agents.service.js');

const databaseUrl = process.env.TEST_DATABASE_URL;

if (!databaseUrl) {
  throw new Error('TEST_DATABASE_URL is required');
}

if (new URL(databaseUrl).pathname !== '/agentgate_test') {
  throw new Error('Integration tests require agentgate_test');
}

test('agent creation requires the current OWNER role', async () => {
  const prisma = new PrismaService(
    new ConfigService({
      DATABASE_URL: databaseUrl,
    }),
  );

  const organizations = new OrganizationsService(prisma);
  const agents = new AgentsService(prisma);

  const userId = randomUUID();
  const organizationName = `test-${randomUUID()}`;
  let organizationId;

  try {
    // Arrange: create the user and their organization.
    await prisma.user.create({
      data: {
        id: userId,
        email: `${userId}@example.test`,
        passwordHash: 'test-fixture-not-for-authentication',
      },
    });

    const organization = await organizations.createForUser(
      userId,
      organizationName,
    );

    organizationId = organization.id;

    // Act: create an agent as the OWNER.
    const agent = await agents.createForUser(userId, {
      organizationId,
      name: 'support-agent',
    });

    // Assert: verify the returned data.
    assert.equal(agent.organizationId, organizationId);
    assert.equal(agent.name, 'support-agent');
    assert.equal(agent.status, 'ACTIVE');

    // Verify the agent was actually saved.
    const storedAgent = await prisma.agent.findFirst({
      where: {
        id: agent.id,
        organizationId,
      },
    });

    assert.ok(storedAgent);
    assert.equal(storedAgent.name, 'support-agent');
    assert.equal(storedAgent.status, 'ACTIVE');

    // Arrange: change the same user's role to MEMBER.
    await prisma.organizationMember.update({
      where: {
        organizationId_userId: {
          organizationId,
          userId,
        },
      },
      data: {
        role: 'MEMBER',
      },
    });

    // Act + Assert: creation must now be forbidden.
    await assert.rejects(
      agents.createForUser(userId, {
        organizationId,
        name: 'blocked-agent',
      }),
      (error) =>
        error instanceof ForbiddenException &&
        error.getStatus() === 403,
    );

    // The rejected request must not create a record.
    const blockedAgentCount = await prisma.agent.count({
      where: {
        organizationId,
        name: 'blocked-agent',
      },
    });

    assert.equal(blockedAgentCount, 0);

    // The previously created agent must remain.
    const existingAgentCount = await prisma.agent.count({
      where: {
        id: agent.id,
        organizationId,
      },
    });

    assert.equal(existingAgentCount, 1);
  } finally {
    try {
      // Remove only this test's data, in foreign-key order.
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
        where: { id: userId },
      });
    } finally {
      await prisma.$disconnect();
    }
  }
});


test('being an owner in one organization grants no access to another', async () => {
  const prisma = new PrismaService(
    new ConfigService({
      DATABASE_URL: databaseUrl,
    }),
  );

  const organizations = new OrganizationsService(prisma);
  const agents = new AgentsService(prisma);

  const userAId = randomUUID();
  const userBId = randomUUID();
  const organizationIds = [];

  try {
    // Arrange: create two independent users.
    await prisma.user.createMany({
      data: [
        {
          id: userAId,
          email: `${userAId}@example.test`,
          passwordHash: 'test-fixture-not-for-authentication',
        },
        {
          id: userBId,
          email: `${userBId}@example.test`,
          passwordHash: 'test-fixture-not-for-authentication',
        },
      ],
    });

    // Each user owns only their own organization.
    const organizationA = await organizations.createForUser(
      userAId,
      `organization-a-${randomUUID()}`,
    );

    organizationIds.push(organizationA.id);

    const organizationB = await organizations.createForUser(
      userBId,
      `organization-b-${randomUUID()}`,
    );

    organizationIds.push(organizationB.id);

    // Act + Assert: owner A cannot create an agent in B.
    await assert.rejects(
      agents.createForUser(userAId, {
        organizationId: organizationB.id,
        name: 'cross-tenant-agent',
      }),
      (error) =>
        typeof error.getStatus === 'function' &&
        error.getStatus() === 404,
    );

    // Owner B cannot create an agent in A either.
    await assert.rejects(
      agents.createForUser(userBId, {
        organizationId: organizationA.id,
        name: 'cross-tenant-agent',
      }),
      (error) =>
        typeof error.getStatus === 'function' &&
        error.getStatus() === 404,
    );

    // Neither rejected operation created any agent.
    const count = await prisma.agent.count({
      where: {
        organizationId: {
          in: organizationIds,
        },
      },
    });

    assert.equal(count, 0);
  } finally {
    try {
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
          id: {
            in: [userAId, userBId],
          },
        },
      });
    } finally {
      await prisma.$disconnect();
    }
  }
});

test('agent names are unique within an organization, not globally', async () => {
  const prisma = new PrismaService(
    new ConfigService({
      DATABASE_URL: databaseUrl,
    }),
  );

  const organizations = new OrganizationsService(prisma);
  const agents = new AgentsService(prisma);

  const userId = randomUUID();
  const organizationIds = [];

  try {
    // Arrange: the same user owns both organizations.
    await prisma.user.create({
      data: {
        id: userId,
        email: `${userId}@example.test`,
        passwordHash: 'test-fixture-not-for-authentication',
      },
    });

    const organizationA = await organizations.createForUser(
      userId,
      `organization-a-${randomUUID()}`,
    );

    organizationIds.push(organizationA.id);

    const organizationB = await organizations.createForUser(
      userId,
      `organization-b-${randomUUID()}`,
    );

    organizationIds.push(organizationB.id);

    // First use of the name in A succeeds.
    const agentA = await agents.createForUser(userId, {
      organizationId: organizationA.id,
      name: 'support-agent',
    });

    // Repeating the name in A is rejected.
    await assert.rejects(
      agents.createForUser(userId, {
        organizationId: organizationA.id,
        name: 'support-agent',
      }),
      (error) =>
        typeof error.getStatus === 'function' &&
        error.getStatus() === 409 &&
        error.message ===
          'Agent name already exists in this organization',
    );

    // The same name in B is allowed.
    const agentB = await agents.createForUser(userId, {
      organizationId: organizationB.id,
      name: 'support-agent',
    });

    assert.notEqual(agentA.id, agentB.id);
    assert.equal(agentA.organizationId, organizationA.id);
    assert.equal(agentB.organizationId, organizationB.id);

    // Verify persistence and absence of duplicate records.
    for (const organizationId of organizationIds) {
      const count = await prisma.agent.count({
        where: {
          organizationId,
          name: 'support-agent',
        },
      });

      assert.equal(count, 1);
    }
  } finally {
    try {
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
        where: { id: userId },
      });
    } finally {
      await prisma.$disconnect();
    }
  }
});