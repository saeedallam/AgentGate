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
const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).pathname !== '/agentgate_test') throw new Error('TEST_DATABASE_URL must target agentgate_test');

test('policy tightening permanently denies saved allowances without rewriting initial evidence', async () => {
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
    await db.agentCredential.create({ data: { id: identity.credentialId, organizationId,
      agentId: identity.agentId, keyPrefix: randomUUID(), keyHash: 'unused' } });
    for (const route of ['submit', 'resume']) for (const effect of ['REQUIRE_APPROVAL', 'DENY']) {
      const key = route + '-' + effect;
      const original = { policyDecision: 'ALLOW', policyReason: 'MATCHED_ALLOW',
        policyHash: 'a'.repeat(64), policyEvaluatedAt: new Date() };
      const receipt = await executions.receive(request, key, () => original);
      const tightened = service(effect);
      await rejects(route === 'submit' ? tightened.submit(identity, body, key)
        : tightened.resume(identity, receipt.id, {}), 'POLICY_TIGHTENED');
      const stored = await db.execution.findUniqueOrThrow({ where: { id: receipt.id }, include: { approval: true } });
      assert.equal(stored.status, 'DENIED');
      assert.equal(stored.policyDecision, 'ALLOW');
      assert.equal(stored.policyReason, original.policyReason);
      assert.equal(stored.policyHash, original.policyHash);
      assert.equal(stored.policyEvaluatedAt.toISOString(), original.policyEvaluatedAt.toISOString());
      assert.equal(stored.errorCode, 'POLICY_TIGHTENED');
      assert.equal(stored.blockedPolicyDecision, effect);
      assert.match(stored.blockedPolicyHash, /^[a-f0-9]{64}$/);
      assert.ok(stored.blockedAt instanceof Date);
      assert.equal(stored.approval, null);
      // Relaxing the rules cannot revive either entry point or the claim itself.
      await rejects(service('ALLOW').submit(identity, body, key), 'POLICY_TIGHTENED');
      await rejects(service('ALLOW').resume(identity, receipt.id, {}), 'POLICY_TIGHTENED');
      assert.equal(await executions.claim(identity, receipt.id), false);
      await assert.rejects(service('ALLOW').submit(identity,
        { ...body, arguments: { ...body.arguments, amountMinor: 4000 } }, key), e => e.getStatus() === 409);
      for (const data of [
        { status: 'RECEIVED', errorCode: null, blockedPolicyDecision: null, blockedPolicyHash: null, blockedAt: null },
        { blockedPolicyHash: 'b'.repeat(64) }, { blockedAt: new Date(0) },
      ]) await assert.rejects(db.execution.update({ where: { id: receipt.id }, data }));
      assert.deepEqual(await db.execution.findUniqueOrThrow({ where: { id: receipt.id }, include: { approval: true } }), stored);
      assert.equal(await db.executionAttempt.count({ where }), 0);
      assert.equal(effects, 0);
    }
  } finally {
    try {
      await db.$transaction([db.approval.deleteMany({ where }), db.executionAttempt.deleteMany({ where }),
        db.execution.deleteMany({ where }), db.agentCredential.deleteMany({ where }), db.agent.deleteMany({ where }), db.organization.deleteMany({ where: { id: organizationId } })]);
    } finally { await db.$disconnect(); }
  }
});
