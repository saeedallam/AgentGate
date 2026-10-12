require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { ConfigService } = require('@nestjs/config');
const { PrismaService } = require('../dist/infrastructure/database/prisma.service.js');
const url = process.env.TEST_DATABASE_URL;
if (!url || new URL(url).pathname !== '/agentgate_test') throw new Error('TEST_DATABASE_URL must target agentgate_test');

test('database freezes approval binding and final decisions while enforcing decision metadata', async () => {
  const db = new PrismaService(new ConfigService({ DATABASE_URL: url }));
  const organizationId = randomUUID(), agentId = randomUUID(), userId = randomUUID();
  const where = { organizationId };
  try {
    await db.organization.create({ data: { id: organizationId, name: 'Binding test' } });
    await db.agent.create({ data: { id: agentId, organizationId, name: 'agent' } });
    await db.user.create({ data: { id: userId, email: userId + '@example.test', passwordHash: 'unused' } });
    const receipt = () => db.execution.create({ data: {
      organizationId, agentId, actionName: 'refund.create', arguments: { paymentId: 'p', amountMinor: 10000, currency: 'USD' },
      environment: 'development', requestedAt: new Date(), requestHash: 'a'.repeat(64),
      policyDecision: 'REQUIRE_APPROVAL', policyReason: 'MATCHED_APPROVAL', policyHash: 'b'.repeat(64), policyEvaluatedAt: new Date(),
    } });
    const execution = await receipt(), other = await receipt();
    const original = await db.approval.create({ data: { organizationId, executionId: execution.id, requestHash: execution.requestHash } });
    for (const data of [{ requestHash: 'c'.repeat(64) }, { executionId: other.id }, { organizationId: randomUUID() }, { id: randomUUID() }, { createdAt: new Date(0) }]) {
      await assert.rejects(db.approval.update({ where: { id: original.id }, data }),
        e => /Approval binding is immutable/.test(e.message));
      assert.deepEqual(await db.approval.findUnique({ where: { id: original.id } }), original);
    }
    await assert.rejects(db.approval.create({ data: { organizationId, executionId: other.id, requestHash: 'c'.repeat(64) } }),
      e => /Approval must bind the original pending request/.test(e.message));
    await assert.rejects(db.approval.create({ data: { organizationId, executionId: other.id, requestHash: other.requestHash,
      status: 'APPROVED', decidedByUserId: userId, decidedAt: new Date() } }), e => /Approval must start pending/.test(e.message));
    await assert.rejects(db.approval.update({ where: { id: original.id }, data: { status: 'APPROVED' } }),
      e => /Approval_decision_metadata/.test(e.message));
    const decidedAt = new Date();
    await db.approval.update({ where: { id: original.id }, data: { status: 'APPROVED', decidedByUserId: userId, decidedAt } });
    for (const data of [{ status: 'PENDING', decidedByUserId: null, decidedAt: null }, { status: 'REJECTED' },
      { decidedByUserId: randomUUID() }, { decidedAt: new Date(0) }]) {
      await assert.rejects(db.approval.update({ where: { id: original.id }, data }), e => /Approval decision is final/.test(e.message));
    }
    assert.equal((await db.approval.findUniqueOrThrow({ where: { id: original.id } })).status, 'APPROVED');
  } finally {
    try {
      await db.$transaction([db.approval.deleteMany({ where }), db.execution.deleteMany({ where }), db.agent.deleteMany({ where }),
        db.organization.deleteMany({ where: { id: organizationId } }), db.user.deleteMany({ where: { id: userId } })]);
    } finally { await db.$disconnect(); }
  }
});
