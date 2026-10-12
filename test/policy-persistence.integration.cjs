require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { ConfigService } = require('@nestjs/config');
const { PrismaService } = require('../dist/infrastructure/database/prisma.service.js');
const { ExecutionsService } = require('../dist/executions/executions.service.js');
const { ActionsService } = require('../dist/actions/actions.service.js');
const { ActionRequestFactory } = require('../dist/actions/action-request.factory.js');
const { ActionRegistry } = require('../dist/actions/action-registry.js');
const { PolicyEngine } = require('../dist/policies/policy-engine.js');
const { PolicyStore } = require('../dist/policies/policy-store.js');
const { actionJson } = require('../dist/executions/action-json.js');
const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).pathname !== '/agentgate_test') throw new Error('TEST_DATABASE_URL must target agentgate_test');

test('policy snapshots survive replay, approvals are atomic, and legacy requests stay blocked', async () => {
  const db = new PrismaService(new ConfigService({ DATABASE_URL: databaseUrl }));
  const organizationId = randomUUID();
  const identity = { organizationId, agentId: randomUUID(), credentialId: randomUUID() };
  const where = { organizationId };
  const config = new ConfigService({ FAKE_EXECUTION_ENABLED: true, NODE_ENV: 'test', ACTION_ENVIRONMENT: 'development' });
  const executions = new ExecutionsService(db);
  let effects = 0;
  const provider = { execute: async () => { effects++; throw new Error('must not dispatch'); } };
  const service = effect => new ActionsService(executions, provider, config,
    new PolicyStore(JSON.stringify([{ organizationId, actionName: 'refund.create', effect, conditions: [] }])), new PolicyEngine());
  const body = { action: { name: 'refund.create' }, arguments: { paymentId: 'snapshot', amountMinor: 5000, currency: 'USD' } };
  const request = new ActionRequestFactory(new ActionRegistry(), 'development').create(identity, body);
  const rejects = (promise, code) => assert.rejects(promise, error => error.getResponse().code === code);
  try {
    await db.organization.create({ data: { id: organizationId, name: 'Snapshot test' } });
    await db.agent.create({ data: { id: identity.agentId, organizationId, name: 'snapshot' } });
    await rejects(service('DENY').submit(identity, body, 'denied'), 'POLICY_DENIED');
    const denied = await db.execution.findFirstOrThrow({ where: { ...where, idempotencyKey: 'denied' } });
    assert.equal(denied.policyDecision, 'DENY');
    assert.equal(denied.policyReason, 'MATCHED_DENY');
    assert.match(denied.policyHash, /^[a-f0-9]{64}$/);
    assert.ok(denied.policyEvaluatedAt instanceof Date);
    await rejects(service('ALLOW').submit(identity, body, 'denied'), 'POLICY_DENIED');
    assert.deepEqual(await db.execution.findUnique({ where: { id: denied.id } }), denied);
    await assert.rejects(service('ALLOW').submit(identity, { ...body, arguments: { ...body.arguments, amountMinor: 4000 } }, 'denied'), e => e.getStatus() === 409);

    await rejects(service('REQUIRE_APPROVAL').submit(identity, body, 'approval'), 'POLICY_APPROVAL_REQUIRED');
    const pending = await db.execution.findFirstOrThrow({ where: { ...where, idempotencyKey: 'approval' }, include: { approval: true } });
    assert.equal(pending.approval.status, 'PENDING');
    assert.equal(pending.approval.requestHash, pending.requestHash);
    await rejects(service('ALLOW').submit(identity, body, 'approval'), 'POLICY_APPROVAL_REQUIRED');
    assert.equal(await db.approval.count({ where }), 1);
    assert.equal((await executions.get(identity, pending.id)).approval.id, pending.approval.id);
    assert.equal(await executions.claim(identity, denied.id), false);
    assert.equal(await executions.claim(identity, pending.id), false);

    const { args, hash } = actionJson(request);
    await db.execution.create({ data: { organizationId, agentId: identity.agentId, idempotencyKey: 'legacy', requestHash: hash,
      actionName: request.action.name, arguments: args, environment: 'development', requestedAt: new Date() } });
    await rejects(service('ALLOW').submit(identity, body, 'legacy'), 'LEGACY_EXECUTION_REQUIRES_REVIEW');

    const failure = new Error('approval insert failed');
    const broken = new ExecutionsService({ execution: db.execution, $transaction: callback => db.$transaction(tx => callback({
      execution: tx.execution, approval: { create: async () => { throw failure; } },
    })) });
    await assert.rejects(broken.receive(request, 'rollback', () => ({ policyDecision: 'REQUIRE_APPROVAL', policyReason: 'MATCHED_APPROVAL', policyHash: 'a'.repeat(64), policyEvaluatedAt: new Date() })), e => e === failure);
    assert.equal(await db.execution.count({ where: { ...where, idempotencyKey: 'rollback' } }), 0);
    assert.equal(await db.executionAttempt.count({ where }), 0);
    assert.equal(effects, 0);
  } finally {
    try {
      await db.$transaction([db.approval.deleteMany({ where }), db.executionAttempt.deleteMany({ where }),
        db.execution.deleteMany({ where }), db.agent.deleteMany({ where }), db.organization.deleteMany({ where: { id: organizationId } })]);
    } finally { await db.$disconnect(); }
  }
});
