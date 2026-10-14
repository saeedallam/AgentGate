require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const url = process.env.TEST_DATABASE_URL;
if (!url || new URL(url).pathname !== '/agentgate_test') throw new Error('TEST_DATABASE_URL must target agentgate_test');
Object.assign(process.env, { DATABASE_URL: url, NODE_ENV: 'test', LOG_LEVEL: 'silent', JWT_ACCESS_SECRET: randomBytes(32).toString('hex'),
  POLICY_RULES_JSON: '[]', FAKE_EXECUTION_ENABLED: 'true', ACTION_ENVIRONMENT: 'development', FAKE_COMMERCE_SCENARIO: 'success' });
const { createApplication } = require('../dist/bootstrap.js');
const { PrismaService } = require('../dist/infrastructure/database/prisma.service.js');
const { ExecutionsService } = require('../dist/executions/executions.service.js');
const { AgentKeyService } = require('../dist/agent-credentials/agent-key.service.js');
const { FakeCommerceProvider } = require('../dist/fake-commerce/fake-commerce.provider.js');
const { PolicyStore } = require('../dist/policies/policy-store.js');
const { verifiedActionRequest } = require('../dist/executions/verified-action-request.js');
const { ConfigService } = require('@nestjs/config');
const { JwtService } = require('@nestjs/jwt');

test('recovery reconciles lost replies, fences stale workers, bounds retries and enforces HTTP authorization', async () => {
  const app = await createApplication(), db = app.get(PrismaService);
  const organizationId = randomUUID(), agentId = randomUUID(), owner = randomUUID(), member = randomUUID(), outsider = randomUUID();
  const scope = { organizationId };
  let policy = 'ALLOW';
  try {
    await app.init(); await app.getHttpAdapter().getInstance().ready();
    app.get(PolicyStore).forOrganization = org => [{ organizationId: org, actionName: 'refund.create', effect: policy, conditions: [] }];
    await db.organization.create({ data: { id: organizationId, name: 'Recovery lab' } });
    await db.agent.create({ data: { id: agentId, organizationId, name: 'recovery-agent' } });
    const key = app.get(AgentKeyService).generate();
    const credential = await db.agentCredential.create({ data: { organizationId, agentId, keyPrefix: key.keyPrefix, keyHash: key.keyHash } });
    const identity = { organizationId, agentId, credentialId: credential.id };
    for (const id of [owner, member, outsider]) await db.user.create({ data: { id, email: id + '@example.test', passwordHash: 'unused' } });
    await db.organizationMember.createMany({ data: [{ organizationId, userId: owner, role: 'OWNER' }, { organizationId, userId: member, role: 'MEMBER' }] });
    const tokens = await Promise.all([owner, member, outsider].map(sub => app.get(JwtService).signAsync({ sub })));
    const config = app.get(ConfigService), provider = app.get(FakeCommerceProvider), executions = app.get(ExecutionsService);
    const send = (path, payload = {}, token = key.apiKey, idempotency) => app.inject({ method: 'POST', url: path,
      headers: { authorization: 'Bearer ' + token, ...(idempotency ? { 'idempotency-key': idempotency } : {}) }, payload });
    const post = async (name, scenario) => {
      await db.fakePayment.create({ data: { organizationId, id: name, amountMinor: 100000 } });
      config.set('FAKE_COMMERCE_SCENARIO', scenario);
      const body = { action: { name: 'refund.create' }, arguments: { paymentId: name, amountMinor: 1000, currency: 'USD' } };
      const response = await send('/v1/actions', body, key.apiKey, name);
      assert.equal(response.statusCode, 200, response.body);
      return response.json();
    };
    const path = (row, op) => '/v1/executions/' + row.id + '/' + op;
    const mature = row => db.execution.update({ where: { id: row.id }, data: { nextRetryAt: new Date(0), leaseExpiresAt: new Date(0) } });

    const lost = await post('lost', 'unknown');
    assert.equal(lost.status, 'OUTCOME_UNKNOWN');
    assert.equal((await send(path(lost, 'resume'))).json().status, 'OUTCOME_UNKNOWN');
    const resolved = await send(path(lost, 'reconcile'));
    assert.equal(resolved.statusCode, 200, resolved.body);
    assert.equal(resolved.json().status, 'SUCCEEDED');
    assert.equal(resolved.json().attempts.length, 1);
    assert.equal(resolved.json().attempts[0].status, 'OUTCOME_UNKNOWN');
    assert.equal(resolved.json().attempts[0].resolvedStatus, 'SUCCEEDED');
    assert.equal((await send(path(lost, 'retry'))).json().attempts.length, 1);

    const missing = await post('missing', 'timeout');
    const observation = (await send(path(missing, 'reconcile'))).json();
    assert.equal(observation.status, 'OUTCOME_UNKNOWN');
    assert.equal(observation.reconciliation.retrySafeFromAbsence, false);
    assert.equal((await send(path(missing, 'retry'))).json().code, 'RETRY_BACKOFF');
    assert.equal((await send(path(missing, 'retry'), { amountMinor: 40000 })).statusCode, 400);
    await mature(missing);
    policy = 'DENY';
    assert.equal((await send(path(missing, 'retry'))).statusCode, 403);
    assert.equal(await db.executionAttempt.count({ where: { executionId: missing.id } }), 1);
    policy = 'ALLOW'; config.set('FAKE_COMMERCE_SCENARIO', 'success');
    const retried = await send(path(missing, 'retry'));
    assert.equal(retried.statusCode, 200, retried.body);
    assert.equal(retried.json().status, 'SUCCEEDED');
    assert.deepEqual(retried.json().attempts.map(a => a.attemptNumber), [1, 2]);
    await assert.rejects(executions.finish(identity, missing.id, { status: 'FAILED', errorCode: 'LATE' }, missing.attempts[0].id), e => e.getStatus() === 409);

    const bounded = await post('bounded', 'timeout');
    for (let n = 2; n <= 3; n++) {
      await mature(bounded);
      const response = await send(path(bounded, 'retry'));
      assert.equal(response.statusCode, 200, response.body);
      assert.equal(response.json().attemptCount, n);
    }
    await mature(bounded);
    assert.equal((await send(path(bounded, 'retry'))).json().code, 'RETRY_LIMIT_REACHED');
    // Even exhausted dispatch budgets may observe a definitive provider receipt.
    const stored = await executions.getStored(identity, bounded.id);
    const request = verifiedActionRequest(stored, stored.requestHash);
    config.set('FAKE_COMMERCE_SCENARIO', 'success');
    const truth = await provider.execute(bounded.id, request);
    assert.equal(truth.status, 'SUCCEEDED');
    assert.equal((await send(path(bounded, 'reconcile'))).json().status, 'SUCCEEDED');
    await assert.rejects(provider.execute(bounded.id, { ...request, arguments: { ...request.arguments, amountMinor: 2000 } }));
    await assert.rejects(db.fakeProviderReceipt.update({ where: { executionId: bounded.id }, data: { requestHash: 'b'.repeat(64) } }));

    // Simulate a process crash AFTER provider commit and BEFORE finish.
    const crashRequest = { ...request, arguments: { ...request.arguments, paymentId: 'crash' }, resource: { type: 'payment', id: 'crash' } };
    await db.fakePayment.create({ data: { organizationId, id: 'crash', amountMinor: 100000 } });
    const snapshot = () => ({ policyDecision: 'ALLOW', policyReason: 'MATCHED_ALLOW', policyHash: 'a'.repeat(64), policyEvaluatedAt: new Date() });
    const crash = await executions.receive(crashRequest, 'crash', snapshot);
    const oldAttempt = randomUUID();
    assert.equal(await executions.claim(identity, crash.id, undefined, oldAttempt), true);
    assert.equal((await send(path(crash, 'retry'))).json().code, 'EXECUTION_LEASE_ACTIVE');
    await provider.execute(crash.id, crashRequest);
    policy = 'DENY';
    assert.equal((await send(path(crash, 'reconcile'))).json().status, 'SUCCEEDED');
    await assert.rejects(executions.finish(identity, crash.id, truth, oldAttempt));

    // Crash BEFORE provider: lease expiry permits a fenced new attempt.
    policy = 'ALLOW';
    const beforeRequest = { ...crashRequest, arguments: { ...crashRequest.arguments, paymentId: 'before' }, resource: { type: 'payment', id: 'before' } };
    await db.fakePayment.create({ data: { organizationId, id: 'before', amountMinor: 100000 } });
    const before = await executions.receive(beforeRequest, 'before', snapshot);
    await executions.claim(identity, before.id, undefined, randomUUID());
    await mature(before);
    assert.equal((await send(path(before, 'reconcile'))).json().status, 'OUTCOME_UNKNOWN');
    await mature(before);
    assert.equal((await send(path(before, 'retry'))).json().status, 'SUCCEEDED');
    assert.equal((await provider.execute(before.id, beforeRequest)).status, 'SUCCEEDED');
    assert.equal(await db.fakeProviderReceipt.count({ where: { executionId: before.id } }), 1);

    // A legacy row cannot be silently upgraded to the new provider contract.
    const legacy = await db.execution.create({ data: { organizationId, agentId, actionName: 'refund.create',
      arguments: request.arguments, environment: 'development', requestedAt: new Date(), status: 'OUTCOME_UNKNOWN' } });
    assert.equal((await send(path(legacy, 'retry'))).json().code, 'LEGACY_RECOVERY_UNSUPPORTED');
    await assert.rejects(db.execution.update({ where: { id: legacy.id }, data: { recoveryVersion: 1 } }));

    // A second agent in the same organization cannot recover this agent's execution.
    const otherAgent = await db.agent.create({ data: { organizationId, name: 'other-agent' } });
    const otherKey = app.get(AgentKeyService).generate();
    await db.agentCredential.create({ data: { organizationId, agentId: otherAgent.id, keyPrefix: otherKey.keyPrefix, keyHash: otherKey.keyHash } });
    assert.equal((await send(path(lost, 'reconcile'), {}, otherKey.apiKey)).statusCode, 404);

    // The receipt is durable evidence even if the lab resource is later removed.
    await db.fakePayment.delete({ where: { organizationId_id: { organizationId, id: 'lost' } } });
    const lostStored = await executions.getStored(identity, lost.id);
    assert.equal((await provider.lookup(lost.id, verifiedActionRequest(lostStored, lostStored.requestHash))).status, 'FOUND');

    // Force failure between effect and receipt finalization: the whole provider TX rolls back.
    const rollbackRequest = { ...request, arguments: { ...request.arguments, paymentId: 'rollback' }, resource: { type: 'payment', id: 'rollback' } };
    await db.fakePayment.create({ data: { organizationId, id: 'rollback', amountMinor: 100000 } });
    const rollback = await executions.receive(rollbackRequest, 'rollback', snapshot);
    const failingDb = new Proxy(db, { get(target, prop) {
      if (prop === '$transaction') return work => target.$transaction(tx => work(new Proxy(tx, { get(inner, key) {
        if (key === 'fakeProviderReceipt') return new Proxy(inner[key], { get(delegate, method) {
          if (method === 'update') return async () => { throw new Error('receipt write failed'); };
          const value = delegate[method]; return typeof value === 'function' ? value.bind(delegate) : value;
        } });
        const value = inner[key]; return typeof value === 'function' ? value.bind(inner) : value;
      } })));
      const value = target[prop]; return typeof value === 'function' ? value.bind(target) : value;
    } });
    await assert.rejects(new FakeCommerceProvider(failingDb, config).execute(rollback.id, rollbackRequest));
    assert.equal(await db.fakeProviderReceipt.count({ where: { executionId: rollback.id } }), 0);
    assert.equal((await db.fakePayment.findUniqueOrThrow({ where: { organizationId_id: { organizationId, id: 'rollback' } } })).refunded, false);

    const observeDisabled = await post('disabled', 'unknown');
    const ownerPath = '/v1/organizations/' + organizationId + '/executions/' + observeDisabled.id + '/reconcile';
    assert.equal((await send(ownerPath, {}, tokens[1])).statusCode, 403);
    assert.equal((await send(ownerPath, {}, tokens[2])).statusCode, 404);
    await db.agent.update({ where: { id: agentId }, data: { status: 'SUSPENDED' } });
    assert.equal((await send(path(observeDisabled, 'retry'))).statusCode, 401);
    const ownerResolved = await send(ownerPath, {}, tokens[0]);
    assert.equal(ownerResolved.statusCode, 200, ownerResolved.body);
    assert.equal(ownerResolved.json().status, 'SUCCEEDED');
    await db.agent.update({ where: { id: agentId }, data: { status: 'ACTIVE' } });
    await db.agentCredential.update({ where: { id: credential.id }, data: { revokedAt: new Date() } });
    assert.equal((await send(path(observeDisabled, 'retry'))).statusCode, 401);
  } finally {
    await db.$transaction([
      db.fakePayment.deleteMany({ where: scope }), db.executionAttempt.deleteMany({ where: scope }),
      db.approval.deleteMany({ where: scope }), db.execution.deleteMany({ where: scope }),
      db.agentCredential.deleteMany({ where: scope }), db.agent.deleteMany({ where: scope }),
      db.organizationMember.deleteMany({ where: scope }), db.organization.deleteMany({ where: { id: organizationId } }),
      db.user.deleteMany({ where: { id: { in: [owner, member, outsider] } } }),
    ]);
    await app.close();
  }
});
