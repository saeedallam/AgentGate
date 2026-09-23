require('reflect-metadata');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { ConfigService } = require('@nestjs/config');

const {
  PrismaService,
} = require('../dist/infrastructure/database/prisma.service.js');

const {
  OrganizationsService,
} = require('../dist/organizations/organizations.service.js');

const databaseUrl = process.env.TEST_DATABASE_URL;

if (!databaseUrl) {
  throw new Error('TEST_DATABASE_URL is required');
}

if (new URL(databaseUrl).pathname !== '/agentgate_test') {
  throw new Error('Integration tests require the agentgate_test database');
}

test('creates owner membership atomically and rolls back on failure', async () => {
  const prisma = new PrismaService(
    new ConfigService({
      DATABASE_URL: databaseUrl,
    }),
  );

  const service = new OrganizationsService(prisma);

  const userId = randomUUID();
  const missingUserId = randomUUID();
  const organizationName = `test-${randomUUID()}`;
  const failedOrganizationName = `rollback-${randomUUID()}`;

  try {
    await prisma.user.create({
      data: {
        id: userId,
        email: `${userId}@example.test`,
        passwordHash: 'test-fixture-not-for-authentication',
      },
    });

    const organization = await service.createForUser(
      userId,
      organizationName,
    );

    const savedOrganization = await prisma.organization.findUnique({
      where: { id: organization.id },
    });

    assert.ok(savedOrganization);
    assert.equal(savedOrganization.name, organizationName);

    const membership = await prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: organization.id,
          userId,
        },
      },
    });

    assert.ok(membership);
    assert.equal(membership.role, 'OWNER');

    await assert.rejects(
      service.createForUser(missingUserId, failedOrganizationName),
      (error) => error.code === 'P2003',
    );

    const orphanCount = await prisma.organization.count({
      where: { name: failedOrganizationName },
    });

    assert.equal(orphanCount, 0);
  } finally {
    try {
      // Delete only this test's records, respecting foreign keys.
      await prisma.organizationMember.deleteMany({
        where: {
          organization: {
            name: {
              in: [organizationName, failedOrganizationName],
            },
          },
        },
      });

      await prisma.organization.deleteMany({
        where: {
          name: {
            in: [organizationName, failedOrganizationName],
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