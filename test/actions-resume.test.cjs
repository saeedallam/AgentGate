require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { ConfigService } = require('@nestjs/config');
const { ActionsService } = require('../dist/actions/actions.service.js');
const { PolicyStore } = require('../dist/policies/policy-store.js');
const { PolicyEngine } = require('../dist/policies/policy-engine.js');
const { actionJson } = require('../dist/executions/action-json.js');
function fixture(effect = 'REQUIRE_APPROVAL') {
  const identity = { organizationId: randomUUID(), agentId: randomUUID(), credentialId: randomUUID() };
  const id = randomUUID();
  const request = { organizationId: identity.organizationId, principal: { type: 'agent', id: identity.agentId },
    action: { name: 'refund.create' }, arguments: { paymentId: 'saved-payment', amountMinor: 10000, currency: 'USD' },
    resource: { type: 'payment', id: 'saved-payment' }, context: { environment: 'development', requestedAt: new Date() } };
  const hash = actionJson(request).hash;
  const approval = { id: randomUUID(), organizationId: identity.organizationId, executionId: id, requestHash: hash,
    status: 'APPROVED', decidedByUserId: randomUUID(), decidedAt: new Date() };
  const execution = { id, organizationId: identity.organizationId, agentId: identity.agentId,
    actionName: request.action.name, arguments: structuredClone(request.arguments), resourceType: 'payment', resourceId: 'saved-payment',
    environment: 'development', requestedAt: request.context.requestedAt, requestHash: hash,
    status: 'RECEIVED', policyDecision: 'REQUIRE_APPROVAL', policyReason: 'MATCHED_APPROVAL', policyHash: 'a'.repeat(64), policyEvaluatedAt: new Date(), approval };
  const calls = [];
  const executions = {
    getStored: async (who, key) => { assert.equal(who, identity); assert.equal(key, id); calls.push('read'); return execution; },
    get: async () => { calls.push('get'); return execution; },
    claim: async (who, key, binding) => {
      assert.equal(who, identity); assert.equal(key, id);
      assert.deepEqual(binding, { id: approval.id, requestHash: hash });
      calls.push('claim'); return true;
    },
    finish: async (_who, _id, outcome) => { calls.push('finish'); return outcome; },
  };
  const provider = { execute: async (key, saved) => { calls.push('provider'); assert.equal(key, id); assert.deepEqual(saved, request);
    return { status: 'SUCCEEDED', result: { simulated: true } }; } };
  const config = new ConfigService({ NODE_ENV: 'test', ACTION_ENVIRONMENT: 'development', FAKE_EXECUTION_ENABLED: true });
  const policies = new PolicyStore(JSON.stringify([{ organizationId: identity.organizationId, actionName: 'refund.create', effect, conditions: [] }]));
  return { identity, id, execution, approval, calls, executions, provider, config, policies,
    service: new ActionsService(executions, provider, config, policies, new PolicyEngine()) };
}

test('approved resume executes the exact stored action after a conditional claim', async () => {
  const f = fixture();
  assert.equal((await f.service.resume(f.identity, f.id, undefined)).status, 'SUCCEEDED');
  assert.deepEqual(f.calls, ['read', 'claim', 'provider', 'finish']);
});


test('current denial, missing approval and rejected approval never reach claim', async () => {
  for (const change of [
    f => { f.approval.status = 'PENDING'; },
    f => { f.approval.status = 'REJECTED'; },
    f => { f.execution.policyDecision = 'DENY'; },
  ]) {
    const f = fixture('ALLOW'); change(f);
    await assert.rejects(f.service.resume(f.identity, f.id, {}), e => e.getStatus() === 403);
    assert.deepEqual(f.calls, ['read']);
  }
  const denied = fixture('DENY');
  await assert.rejects(denied.service.resume(denied.identity, denied.id, {}), e => e.getResponse().code === 'POLICY_DENIED');
  assert.deepEqual(denied.calls, ['read']);
  const allowed = fixture('ALLOW');
  assert.equal((await allowed.service.resume(allowed.identity, allowed.id, {})).status, 'SUCCEEDED');
});

test('changed payload, hashes, bindings, environment and incomplete evidence fail closed', async () => {
  for (const change of [
    f => { f.execution.arguments.amountMinor = 40000; },
    f => { f.approval.requestHash = 'b'.repeat(64); },
    f => { f.execution.requestHash = 'c'.repeat(64); },
    f => { f.approval.executionId = randomUUID(); },
    f => { f.approval.organizationId = randomUUID(); },
    f => { f.approval.decidedAt = null; },
    f => { f.approval.decidedByUserId = null; },
    f => { f.execution.approval = null; },
    f => { f.execution.policyHash = null; },
    f => { f.config.set('ACTION_ENVIRONMENT', 'staging'); },
  ]) {
    const f = fixture(); change(f);
    await assert.rejects(f.service.resume(f.identity, f.id, {}), e => e.getStatus() === 409);
    assert.deepEqual(f.calls, ['read']);
  }
});

test('resume rejects supplied payloads and disabled lab before reading storage', async () => {
  for (const input of [null, [], { amountMinor: 1 }, { approvalId: randomUUID() }, { organizationId: randomUUID() }]) {
    const f = fixture();
    await assert.rejects(f.service.resume(f.identity, f.id, input), e => e.getStatus() === 400);
    assert.deepEqual(f.calls, []);
  }
  for (const [key, value] of [['NODE_ENV', 'production'], ['ACTION_ENVIRONMENT', 'production'], ['FAKE_EXECUTION_ENABLED', false]]) {
    const f = fixture(); f.config.set(key, value);
    await assert.rejects(f.service.resume(f.identity, f.id, {}), e => e.getStatus() === 503);
    assert.deepEqual(f.calls, []);
  }
});

test('started, finished and ambiguous executions replay without policy evaluation or another claim', async () => {
  for (const status of ['EXECUTING', 'SUCCEEDED', 'FAILED', 'OUTCOME_UNKNOWN']) {
    const f = fixture(); f.execution.status = status;
    f.policies.forOrganization = () => { assert.fail('must not reevaluate started executions'); };
    assert.equal((await f.service.resume(f.identity, f.id, {})).status, status);
    assert.deepEqual(f.calls, ['read', 'get']);
  }
  const f = fixture();
  f.executions.claim = async () => { f.calls.push('claim'); return false; };
  await f.service.resume(f.identity, f.id, {});
  assert.deepEqual(f.calls, ['read', 'claim', 'get']);
});

test('policy errors block dispatch; provider ambiguity is recorded; save failures propagate', async () => {
  const f = fixture();
  f.policies.forOrganization = () => { throw new Error('private-policy'); };
  await assert.rejects(f.service.resume(f.identity, f.id, {}), e => e.getStatus() === 503 && !e.message.includes('private-policy'));
  assert.deepEqual(f.calls, ['read']);
  const unknown = fixture();
  unknown.provider.execute = async () => { throw new Error('response lost'); };
  assert.equal((await unknown.service.resume(unknown.identity, unknown.id, {})).status, 'OUTCOME_UNKNOWN');
  const saved = fixture();
  const failure = new Error('storage unavailable');
  saved.executions.finish = async () => { throw failure; };
  await assert.rejects(saved.service.resume(saved.identity, saved.id, {}), e => e === failure);
  assert.equal(saved.calls.filter(c => c === 'provider').length, 1);
});
