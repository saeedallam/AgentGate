require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ConfigService } = require('@nestjs/config');
const { ActionsService } = require('../dist/actions/actions.service.js');
const { PolicyEngine } = require('../dist/policies/policy-engine.js');
const { PolicyStore } = require('../dist/policies/policy-store.js');
const identity = { organizationId: '1832bd19-038d-49b8-895e-c45a71a9c606', agentId: '1243ad83-6e58-4e62-8613-40c830fff17b', credentialId: 'a9290ef0-dbf5-4a24-b521-d9e9cd89b08d' };
const body = { action: { name: 'refund.create' }, arguments: { paymentId: 'payment_demo', amountMinor: 5000, currency: 'USD' } };
const rule = effect => ({ organizationId: identity.organizationId, actionName: 'refund.create', effect, conditions: [] });
function fixture(rules = [], status = 'RECEIVED') {
  const calls = [];
  const execution = { id: 'execution-1', status };
  const executions = {
    receive: async (_request, _key, evaluate) => { calls.push('receive'); if (status === 'RECEIVED') Object.assign(execution, evaluate()); return execution; },
    get: async () => { calls.push('get'); return execution; },
    claim: async () => { calls.push('claim'); return true; },
    finish: async (_identity, _id, outcome) => { calls.push('finish'); return outcome; },
  };
  const provider = { execute: async () => { calls.push('provider'); return { status: 'SUCCEEDED', result: { simulated: true } }; } };
  const config = new ConfigService({ FAKE_EXECUTION_ENABLED: true, NODE_ENV: 'test', ACTION_ENVIRONMENT: 'development' });
  const store = new PolicyStore(JSON.stringify(rules));
  const engine = new PolicyEngine();
  return { calls, executions, store, engine, service: new ActionsService(executions, provider, config, store, engine) };
}

test('deny, default deny and approval stop before claim and provider', async () => {
  for (const [rules, code] of [[[], 'POLICY_DENIED'], [[rule('DENY')], 'POLICY_DENIED'], [[rule('REQUIRE_APPROVAL')], 'POLICY_APPROVAL_REQUIRED']]) {
    const f = fixture(rules);
    await assert.rejects(f.service.submit(identity, body, 'key'), e => e.getStatus() === 403 && e.getResponse().code === code && e.getResponse().executionId === 'execution-1');
    assert.deepEqual(f.calls, ['receive']);
  }
});

test('allow dispatches only after a successful claim', async () => {
  const f = fixture([rule('ALLOW')]);
  assert.equal((await f.service.submit(identity, body, 'key')).status, 'SUCCEEDED');
  assert.deepEqual(f.calls, ['receive', 'claim', 'provider', 'finish']);
  const loser = fixture([rule('ALLOW')]);
  loser.executions.claim = async () => { loser.calls.push('claim'); return false; };
  await loser.service.submit(identity, body, 'key');
  assert.deepEqual(loser.calls, ['receive', 'claim', 'get']);
});

test('started and completed executions replay without policy redispatch', async () => {
  for (const status of ['EXECUTING', 'SUCCEEDED', 'FAILED', 'OUTCOME_UNKNOWN']) {
    const f = fixture([], status);
    f.engine.evaluateDetailed = () => { throw new Error('must not reevaluate past dispatch'); };
    assert.equal((await f.service.submit(identity, body, 'key')).status, status);
    assert.deepEqual(f.calls, ['receive', 'get']);
  }
});

test('policy failure never reaches claim or provider and details stay private', async () => {
  const f = fixture([rule('ALLOW')]);
  f.store.forOrganization = () => { throw new Error('private-policy-content'); };
  await assert.rejects(f.service.submit(identity, body, 'key'), e => e.getStatus() === 503 && !e.message.includes('private-policy-content'));
  assert.deepEqual(f.calls, ['receive']);
});

test('foreign grants and client-supplied policies cannot authorize dispatch', async () => {
  const f = fixture([{ ...rule('ALLOW'), organizationId: '55059eb2-2eaf-4def-a294-0be25e5099c8' }]);
  await assert.rejects(f.service.submit(identity, body, 'key'), e => e.getStatus() === 403);
  const spoof = fixture([rule('ALLOW')]);
  await assert.rejects(spoof.service.submit(identity, { ...body, policies: [rule('ALLOW')] }, 'key'), e => e.getStatus() === 400);
  assert.deepEqual(spoof.calls, []);
});

test('idempotency conflicts remain conflicts before evaluating new permission', async () => {
  const f = fixture([]);
  const { ConflictException } = require('@nestjs/common');
  f.executions.receive = async () => { throw new ConflictException('Payload changed'); };
  await assert.rejects(f.service.submit(identity, body, 'key'), e => e.getStatus() === 409);
  assert.deepEqual(f.calls, []);
});

test('legacy RECEIVED without a recorded policy decision requires review without reevaluation', async () => {
  const f = fixture([rule('ALLOW')]);
  let evaluations = 0;
  f.executions.receive = async () => {
    f.calls.push('receive');
    return { id: 'legacy-execution', status: 'RECEIVED', policyDecision: null };
  };
  f.engine.evaluateDetailed = () => { evaluations++; return 'ALLOW'; };

  await assert.rejects(
    f.service.submit(identity, body, 'legacy-key'),
    error => error.getStatus() === 409
      && error.getResponse().code === 'LEGACY_EXECUTION_REQUIRES_REVIEW',
  );
  assert.equal(evaluations, 0);
  assert.deepEqual(f.calls, ['receive']);
});

test('current deny blocks a saved allowance without changing its original decision', async () => {
  const f = fixture([rule('DENY')]);
  const saved = { id: 'allowed-before', status: 'RECEIVED', policyDecision: 'ALLOW', policyReason: 'MATCHED_ALLOW', policyHash: 'a'.repeat(64), policyEvaluatedAt: new Date() };
  f.executions.receive = async () => { f.calls.push('receive'); return saved; };
  f.executions.denyForPolicyTightening = async () => { f.calls.push('deny'); return { ...saved, status: 'DENIED' }; };
  await assert.rejects(f.service.submit(identity, body, 'key'), e => e.getResponse().code === 'POLICY_TIGHTENED');
  assert.equal(saved.policyDecision, 'ALLOW');
  assert.deepEqual(f.calls, ['receive', 'deny']);
});

test('tightening write failures propagate and cannot reach claim or provider', async () => {
  const f = fixture([rule('REQUIRE_APPROVAL')]);
  f.executions.receive = async () => ({ id: 'saved', status: 'RECEIVED', policyDecision: 'ALLOW',
    policyReason: 'MATCHED_ALLOW', policyHash: 'a'.repeat(64), policyEvaluatedAt: new Date() });
  const failure = new Error('database unavailable');
  f.executions.denyForPolicyTightening = async () => { throw failure; };
  await assert.rejects(f.service.submit(identity, body, 'key'), e => e === failure);
  assert.deepEqual(f.calls, []);
});

test('claim losers report permanent denial while a denial loser reports the started execution', async () => {
  const f = fixture([rule('ALLOW')]);
  f.executions.claim = async () => false;
  f.executions.get = async () => ({ id: 'saved', status: 'DENIED' });
  await assert.rejects(f.service.submit(identity, body, 'key'), e => e.getResponse().code === 'POLICY_TIGHTENED');
  assert.ok(!f.calls.includes('provider'));

  const tightened = fixture([rule('REQUIRE_APPROVAL')]);
  tightened.executions.receive = async () => ({ id: 'saved', status: 'RECEIVED', policyDecision: 'ALLOW',
    policyReason: 'MATCHED_ALLOW', policyHash: 'a'.repeat(64), policyEvaluatedAt: new Date() });
  tightened.executions.denyForPolicyTightening = async () => ({ id: 'saved', status: 'EXECUTING' });
  assert.equal((await tightened.service.submit(identity, body, 'key')).status, 'EXECUTING');
  assert.ok(!tightened.calls.includes('provider'));
});
