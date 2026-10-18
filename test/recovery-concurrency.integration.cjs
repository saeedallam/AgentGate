require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { ConfigService } = require('@nestjs/config');
const { PrismaService } = require('../dist/infrastructure/database/prisma.service.js');
const { ExecutionsService } = require('../dist/executions/executions.service.js');
const { FakeCommerceProvider } = require('../dist/fake-commerce/fake-commerce.provider.js');
const url = process.env.TEST_DATABASE_URL;
if (!url || new URL(url).pathname !== '/agentgate_test') throw new Error('TEST_DATABASE_URL must target agentgate_test');

function gate() {
  let count = 0, release, fail;
  const ready = new Promise((resolve, reject) => { release = resolve; fail = reject; });
  const timer = setTimeout(() => fail(new Error('Concurrent connections did not rendezvous')), 3000);
  return async () => { if (++count === 2) { clearTimeout(timer); release(); } await ready; };
}
// Gate before the first statement, before row locks are taken. SQL/results remain real.
function synchronized(db, wait, pids) {
  return new Proxy(db, { get(target, key) {
    if (key === '$transaction') return (work, options) => target.$transaction(async tx => {
      const [row] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;
      pids.add(row.pid);
      await wait();
      return work(tx);
    }, options);
    const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
  } });
}

test('native independent retries fence old completions and provider races commit one durable effect', { timeout: 30000 }, async () => {
  const clients = [0, 1].map(() => new PrismaService(new ConfigService({ DATABASE_URL: url })));
  const [db] = clients;
  const organizationId = randomUUID(), agentId = randomUUID(), scope = { organizationId };
  try {
    await db.organization.create({ data: { id: organizationId, name: 'Recovery races' } });
    await db.agent.create({ data: { id: agentId, organizationId, name: 'race-agent' } });
    const credential = await db.agentCredential.create({ data: { organizationId, agentId, keyPrefix: randomUUID(), keyHash: 'unused' } });
    const identity = { organizationId, agentId, credentialId: credential.id };
    const request = { organizationId, principal: { type: 'agent', id: agentId }, action: { name: 'refund.create' },
      arguments: { paymentId: 'race', amountMinor: 1000, currency: 'USD' }, resource: { type: 'payment', id: 'race' },
      context: { environment: 'development', requestedAt: new Date() } };
    await db.fakePayment.create({ data: { organizationId, id: 'race', amountMinor: 100000 } });
    const service = new ExecutionsService(db, new (require('@nestjs/config').ConfigService)({ REFUND_BUDGETS_JSON: '[]' }));
    const execution = await service.receive(request, 'race', () => ({ policyDecision: 'ALLOW', policyReason: 'MATCHED_ALLOW', policyHash: 'a'.repeat(64), policyEvaluatedAt: new Date() }));
    const firstAttempt = randomUUID();
    await service.claim(identity, execution.id, undefined, firstAttempt);
    await db.execution.update({ where: { id: execution.id }, data: { leaseExpiresAt: new Date(0) } });
    let wait = gate(), pids = new Set();
    const attempts = [randomUUID(), randomUUID()];
    const claims = await Promise.all(clients.map((client, i) =>
      new ExecutionsService(synchronized(client, wait, pids), new (require('@nestjs/config').ConfigService)({ REFUND_BUDGETS_JSON: '[]' })).claimRetry(identity, execution.id, 1, attempts[i])));
    assert.equal(pids.size, 2);
    assert.deepEqual(claims.slice().sort(), [false, true]);
    const winnerId = attempts[claims.findIndex(Boolean)];
    assert.equal(await db.executionAttempt.count({ where: { executionId: execution.id, status: 'EXECUTING' } }), 1);
    assert.equal(await db.executionAttempt.count({ where: { executionId: execution.id } }), 2);
    await assert.rejects(service.finish(identity, execution.id, { status: 'FAILED', errorCode: 'LATE_OLD_WORKER' }, firstAttempt), e => e.getStatus() === 409);
    assert.equal((await service.get(identity, execution.id)).status, 'EXECUTING');
    // Original slow worker and retry both arrive at provider with the SAME operation key.
    wait = gate(); pids = new Set();
    const config = new ConfigService({ FAKE_COMMERCE_SCENARIO: 'success' });
    const outcomes = await Promise.all(clients.map(client =>
      new FakeCommerceProvider(synchronized(client, wait, pids), config).execute(execution.id, request)));
    assert.equal(pids.size, 2);
    assert.deepEqual(outcomes[0], outcomes[1]);
    assert.equal(outcomes[0].status, 'SUCCEEDED');
    assert.equal(await db.fakeProviderReceipt.count({ where: { executionId: execution.id } }), 1);
    assert.equal((await db.fakePayment.findUniqueOrThrow({ where: { organizationId_id: { organizationId, id: 'race' } } })).refundExecutionId, execution.id);

    // Reconciliation and a worker finishing contend on the same execution row.
    wait = gate(); pids = new Set();
    const finishes = await Promise.allSettled([
      new ExecutionsService(synchronized(clients[0], wait, pids), new (require('@nestjs/config').ConfigService)({ REFUND_BUDGETS_JSON: '[]' })).finish(identity, execution.id, outcomes[0], winnerId),
      new ExecutionsService(synchronized(clients[1], wait, pids), new (require('@nestjs/config').ConfigService)({ REFUND_BUDGETS_JSON: '[]' })).reconcile(identity, execution.id, outcomes[1]),
    ]);
    assert.equal(pids.size, 2);
    for (const row of finishes) if (row.status === 'rejected') assert.equal(row.reason.getStatus(), 409);
    const final = await service.get(identity, execution.id);
    assert.equal(final.status, 'SUCCEEDED');
    assert.equal(final.attempts.some(a => a.status === 'EXECUTING'), false);
    assert.equal(final.attempts[0].resolvedStatus, 'SUCCEEDED');
    await assert.rejects(db.executionAttempt.update({ where: { id: firstAttempt }, data: { attemptNumber: 3 } }));
  } finally {
    await db.$transaction([
      db.fakePayment.deleteMany({ where: scope }), db.executionAttempt.deleteMany({ where: scope }),
      db.approval.deleteMany({ where: scope }), db.execution.deleteMany({ where: scope }),
      db.agentCredential.deleteMany({ where: scope }), db.agent.deleteMany({ where: scope }),
      db.organization.deleteMany({ where: { id: organizationId } }),
    ]);
    await Promise.all(clients.map(client => client.$disconnect()));
  }
});
