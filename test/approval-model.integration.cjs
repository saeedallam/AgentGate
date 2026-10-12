require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { ConfigService } = require('@nestjs/config');
const { PrismaService } = require('../dist/infrastructure/database/prisma.service.js');

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).pathname !== '/agentgate_test') {
  throw new Error('TEST_DATABASE_URL must target agentgate_test');
}

test('approval is unique per execution and cannot cross organization boundaries', async () => {
  const db = new PrismaService(new ConfigService({ DATABASE_URL: databaseUrl }));
  const organizationA = randomUUID();
  const organizationB = randomUUID();
  const agentId = randomUUID();
  const scope = { organizationId: { in: [organizationA, organizationB] } };
  let fixturesStarted = false;
  let failed = false;

  try {
    assert.ok(db.approval, 'Prisma Client must expose the Approval model');
    fixturesStarted = true;
    await db.organization.createMany({ data: [
      { id: organizationA, name: 'Approval test A' },
      { id: organizationB, name: 'Approval test B' },
    ] });
    await db.agent.create({ data: { id: agentId, organizationId: organizationA, name: 'approval-test' } });
    const execution = await db.execution.create({ data: {
      organizationId: organizationA, agentId,
      actionName: 'refund.create', arguments: { paymentId: 'payment_test', amountMinor: 10000, currency: 'USD' },
      environment: 'development', requestedAt: new Date(),
      requestHash: 'a'.repeat(64), policyDecision: 'REQUIRE_APPROVAL',
      policyReason: 'MATCHED_APPROVAL', policyHash: 'b'.repeat(64), policyEvaluatedAt: new Date(),
    } });
    const data = { organizationId: organizationA, executionId: execution.id, requestHash: 'a'.repeat(64) };

    // Try the foreign link before creating a valid approval: otherwise UNIQUE
    // could hide a missing tenant foreign-key constraint.
    await assert.rejects(
      db.approval.create({ data: { ...data, organizationId: organizationB } }),
      error => error.code === 'P2003',
    );
    const approval = await db.approval.create({ data });
    assert.equal(approval.status, 'PENDING');
    assert.equal(approval.decidedByUserId, null);
    assert.equal(approval.decidedAt, null);
    await assert.rejects(db.approval.create({ data }), error => error.code === 'P2002');
    assert.equal(await db.approval.count({ where: { executionId: execution.id } }), 1);
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    try {
      if (fixturesStarted) {
        await db.$transaction([
          db.approval.deleteMany({ where: scope }),
          db.execution.deleteMany({ where: scope }),
          db.agent.deleteMany({ where: scope }),
          db.organization.deleteMany({ where: { id: { in: [organizationA, organizationB] } } }),
        ]);
      }
    } catch (cleanupError) {
      if (!failed) throw cleanupError;
    } finally {
      await db.$disconnect();
    }
  }
});
