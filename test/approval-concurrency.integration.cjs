require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { ConfigService } = require('@nestjs/config');
const { PrismaService } = require('../dist/infrastructure/database/prisma.service.js');
const { ApprovalsService } = require('../dist/approvals/approvals.service.js');
const { ExecutionsService } = require('../dist/executions/executions.service.js');

const url = process.env.TEST_DATABASE_URL;
if (!url || new URL(url).pathname !== '/agentgate_test') throw new Error('TEST_DATABASE_URL must target agentgate_test');

// Both real transactions reach the write before either is released. No sleeps and
// no mocked SQL results: PostgreSQL must resolve the competing writes itself.
function barrier() {
  let count = 0, release, reject;
  const ready = new Promise((resolve, fail) => { release = resolve; reject = fail; });
  const timer = setTimeout(() => reject(new Error('Both database transactions did not reach the barrier')), 3000);
  return async () => {
    if (++count === 2) { clearTimeout(timer); release(); }
    await ready;
  };
}
function synchronized(db, model, method, rendezvous, pids) {
  return {
    execution: new Proxy(db.execution, { get(target, key) {
      if (model === 'execution' && key === method) return (...args) => db.$transaction(async tx => {
        const [row] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;
        pids.add(row.pid);
        await rendezvous();
        return tx.execution[method](...args);
      });
      const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
    } }),
    $transaction: (callback, options) => db.$transaction(async tx => {
      const [row] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;
      pids.add(row.pid);
      const delegate = new Proxy(tx[model], { get(target, key) {
        if (key === method) return async (...args) => { await rendezvous(); return target[method](...args); };
        const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
      } });
      return callback(new Proxy(tx, { get(target, key) {
        if (key === model) return delegate;
        const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
      } }));
    }, options),
  };
}

test('native PostgreSQL resolves competing receipts, owner decisions and claims across independent connections', { timeout: 30000 }, async () => {
  const clients = [0, 1].map(() => new PrismaService(new ConfigService({ DATABASE_URL: url })));
  const [db] = clients;
  const organizationId = randomUUID(), agentId = randomUUID(), owners = [randomUUID(), randomUUID()];
  const scope = { organizationId };
  try {
    await db.organization.create({ data: { id: organizationId, name: 'Independent connection races' } });
    await db.agent.create({ data: { id: agentId, organizationId, name: 'race-agent' } });
    const credential = await db.agentCredential.create({ data: { organizationId, agentId, keyPrefix: randomUUID(), keyHash: 'unused' } });
    for (const id of owners) {
      await db.user.create({ data: { id, email: id + '@example.test', passwordHash: 'unused' } });
      await db.organizationMember.create({ data: { organizationId, userId: id, role: 'OWNER' } });
    }
    const identity = { organizationId, agentId, credentialId: credential.id };
    const request = {
      organizationId, principal: { type: 'agent', id: agentId }, action: { name: 'refund.create' },
      arguments: { paymentId: 'race-payment', amountMinor: 10000, currency: 'USD' },
      resource: { type: 'payment', id: 'race-payment' },
      context: { environment: 'development', requestedAt: new Date() },
    };
    const snapshot = decision => ({ policyDecision: decision, policyReason: 'MATCHED_' + (decision === 'REQUIRE_APPROVAL' ? 'APPROVAL' : decision), policyHash: 'a'.repeat(64), policyEvaluatedAt: new Date() });

    // Competing snapshots must return the one committed receipt, never overwrite it.
    let gate = barrier(), pids = new Set();
    let services = clients.map(client => new ExecutionsService(synchronized(client, 'execution', 'createMany', gate, pids)));
    const receipts = await Promise.all(services.map((service, i) => service.receive(request, 'decision-race', () => snapshot(i ? 'ALLOW' : 'DENY'))));
    assert.equal(pids.size, 2, 'requires native independent PostgreSQL backend sessions');
    assert.equal(receipts[0].id, receipts[1].id);
    assert.equal(receipts[0].policyDecision, receipts[1].policyDecision);
    assert.equal(await db.execution.count({ where: { ...scope, idempotencyKey: 'decision-race' } }), 1);

    // Duplicate approval requests create one pending record atomically.
    gate = barrier(); pids = new Set();
    services = clients.map(client => new ExecutionsService(synchronized(client, 'execution', 'createMany', gate, pids)));
    const pending = await Promise.all(services.map(service => service.receive(request, 'approval-race', () => snapshot('REQUIRE_APPROVAL'))));
    assert.equal(pids.size, 2);
    assert.equal(pending[0].approval.id, pending[1].approval.id);
    assert.equal(await db.approval.count({ where: scope }), 1);

    // Both owners read PENDING before either updates. Exactly one decision commits.
    gate = barrier(); pids = new Set();
    const decisions = ['APPROVED', 'REJECTED'];
    const results = await Promise.allSettled(clients.map((client, i) =>
      new ApprovalsService(synchronized(client, 'approval', 'updateMany', gate, pids))
        .decide(owners[i], pending[0].approval.id, { decision: decisions[i] })));
    assert.equal(pids.size, 2);
    assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
    const loser = results.find(row => row.status === 'rejected');
    assert.equal(loser.reason.getStatus(), 409);
    const winner = results.findIndex(row => row.status === 'fulfilled');
    const saved = await db.approval.findUniqueOrThrow({ where: { id: pending[0].approval.id } });
    assert.equal(saved.status, decisions[winner]); assert.equal(saved.decidedByUserId, owners[winner]);
    assert.equal(saved.decidedAt.toISOString(), results[winner].value.decidedAt.toISOString());
    assert.equal(await db.executionAttempt.count({ where: scope }), 0);

    // Use a separately approved receipt so either owner can win the previous race.
    const executions = new ExecutionsService(db);
    const approved = await executions.receive(request, 'claim-race', () => snapshot('REQUIRE_APPROVAL'));
    await new ApprovalsService(db).decide(owners[0], approved.approval.id, { decision: 'APPROVED' });
    gate = barrier(); pids = new Set();
    services = clients.map(client => new ExecutionsService(synchronized(client, 'execution', 'updateMany', gate, pids)));
    const binding = { id: approved.approval.id, requestHash: approved.requestHash };
    const claims = await Promise.all(services.map(service => service.claim(identity, approved.id, binding)));
    assert.equal(pids.size, 2); assert.deepEqual(claims.slice().sort(), [false, true]);
    assert.equal(await db.executionAttempt.count({ where: { executionId: approved.id } }), 1);
    assert.equal((await db.execution.findUniqueOrThrow({ where: { id: approved.id } })).status, 'EXECUTING');

    // Denial and claim contend on the same RECEIVED row using independent sessions.
    for (let i = 0; i < 3; i++) {
      const receipt = await executions.receive(request, 'denial-claim-' + i, () => snapshot('ALLOW'));
      gate = barrier(); pids = new Set();
      services = clients.map(client => new ExecutionsService(synchronized(client, 'execution', 'updateMany', gate, pids)));
      const evidence = snapshot('REQUIRE_APPROVAL');
      const [denial, claimed] = await Promise.all([
        services[0].denyForPolicyTightening(identity, receipt.id, evidence),
        services[1].claim(identity, receipt.id),
      ]);
      assert.equal(pids.size, 2);
      const final = await db.execution.findUniqueOrThrow({ where: { id: receipt.id } });
      assert.equal(final.status, claimed ? 'EXECUTING' : 'DENIED');
      assert.equal(denial.status, final.status);
      assert.equal(await db.executionAttempt.count({ where: { executionId: receipt.id } }), claimed ? 1 : 0);
      assert.equal(final.policyDecision, 'ALLOW');
      if (claimed) {
        assert.equal(final.blockedAt, null);
        assert.equal((await executions.denyForPolicyTightening(identity, receipt.id, evidence)).status, 'EXECUTING');
      } else {
        assert.equal(final.errorCode, 'POLICY_TIGHTENED');
        assert.equal(await executions.claim(identity, receipt.id), false);
      }
    }
  } finally {
    try {
      await db.$transaction([
        db.executionAttempt.deleteMany({ where: scope }), db.approval.deleteMany({ where: scope }),
        db.execution.deleteMany({ where: scope }), db.agentCredential.deleteMany({ where: scope }),
        db.agent.deleteMany({ where: scope }), db.organizationMember.deleteMany({ where: scope }),
        db.organization.deleteMany({ where: { id: organizationId } }), db.user.deleteMany({ where: { id: { in: owners } } }),
      ]);
    } finally { await Promise.all(clients.map(client => client.$disconnect())); }
  }
});
