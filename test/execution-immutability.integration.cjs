require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { ConfigService } = require('@nestjs/config');
const { PrismaService } = require('../dist/infrastructure/database/prisma.service.js');
const url = process.env.TEST_DATABASE_URL;
if (!url || new URL(url).pathname !== '/agentgate_test') throw new Error('TEST_DATABASE_URL must target agentgate_test');

test('database rejects changes to request evidence but permits recording progress and outcomes', async () => {
  const db = new PrismaService(new ConfigService({ DATABASE_URL: url }));
  const organizationId = randomUUID();
  const agentId = randomUUID();
  const where = { organizationId };
  try {
    await db.organization.create({ data: { id: organizationId, name: 'Immutable request test' } });
    await db.agent.create({ data: { id: agentId, organizationId, name: 'test' } });
    const original = await db.execution.create({ data: {
      organizationId, agentId, actionName: 'refund.create',
      arguments: { paymentId: 'p', amountMinor: 10000, currency: 'USD' },
      environment: 'development', requestedAt: new Date(), idempotencyKey: 'immutable',
      requestHash: 'a'.repeat(64), policyDecision: 'ALLOW', policyReason: 'MATCHED_ALLOW',
      policyHash: 'b'.repeat(64), policyEvaluatedAt: new Date(),
    } });
    // Each attempt must fail specifically because of our trigger, not another constraint.
    const changes = [
      { arguments: { ...original.arguments, amountMinor: 40000 } },
      { arguments: { ...original.arguments, currency: 'EUR' } },
      { actionName: 'other.action' }, { resourceType: 'payment', resourceId: 'other' },
      { environment: 'production' }, { agentId: randomUUID() }, { organizationId: randomUUID() },
      { requestHash: 'c'.repeat(64) }, { idempotencyKey: 'other' }, { id: randomUUID() },
      { requestedAt: new Date(0) }, { createdAt: new Date(0) },
      { policyDecision: 'DENY' }, { policyReason: 'other' },
      { policyHash: 'c'.repeat(64) }, { policyEvaluatedAt: new Date(0) },
    ];
    for (const data of changes) {
      await assert.rejects(db.execution.update({ where: { id: original.id }, data }),
        error => /Execution request evidence is immutable/.test(error.message));
      assert.deepEqual(await db.execution.findUnique({ where: { id: original.id } }), original);
    }
    // Direct SQL bypasses TypeScript and the application service, but not this trigger.
    await assert.rejects(db.$executeRaw`UPDATE "Execution" SET "arguments" = '{"amountMinor":40000}'::jsonb WHERE "id" = ${original.id}::uuid`,
      error => /Execution request evidence is immutable/.test(error.message));
    await db.execution.update({ where: { id: original.id }, data: { status: 'EXECUTING' } });
    const finished = await db.execution.update({ where: { id: original.id }, data: {
      status: 'SUCCEEDED', result: { simulated: true }, errorCode: null,
    } });
    assert.equal(finished.status, 'SUCCEEDED');
    assert.deepEqual(finished.arguments, original.arguments);
    assert.deepEqual(finished.result, { simulated: true });
    // Unchanged NULL resource values must not falsely count as a mutation.
    assert.equal(finished.resourceId, null);
  } finally {
    try {
      await db.execution.deleteMany({ where });
      await db.agent.deleteMany({ where });
      await db.organization.deleteMany({ where: { id: organizationId } });
    } finally { await db.$disconnect(); }
  }
});
