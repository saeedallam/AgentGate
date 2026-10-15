require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { ConfigService } = require('@nestjs/config');
const { PrismaService } = require('../dist/infrastructure/database/prisma.service.js');
const { ExecutionsService } = require('../dist/executions/executions.service.js');
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

test('native daily budget serializes competing agents and settles/retries without double accounting', { timeout: 30000 }, async () => {
  const clients = [0,1].map(() => new PrismaService(new ConfigService({ DATABASE_URL: url })));
  const [db] = clients, organizationId = randomUUID(), scope = { organizationId };
  const config = new ConfigService({ REFUND_BUDGETS_JSON: JSON.stringify([{ organizationId, environment: 'development', currency: 'USD', limitMinor: 10000 }]) });
  try {
    await db.organization.create({ data: { id: organizationId, name: 'Budget race' } });
    const identities = [], requests = [], executions = [], service = new ExecutionsService(db, config);
    for (let i=0; i<2; i++) {
      const agent = await db.agent.create({ data: { organizationId, name: 'agent-'+i } });
      const credential = await db.agentCredential.create({ data: { organizationId, agentId: agent.id, keyPrefix: randomUUID(), keyHash: 'unused' } });
      const identity = { organizationId, agentId: agent.id, credentialId: credential.id }; identities.push(identity);
      const request = { organizationId, principal: { type: 'agent', id: agent.id }, action: { name: 'refund.create' },
        arguments: { paymentId: 'p-'+i, amountMinor: 6000, currency: 'USD' }, resource: { type: 'payment', id: 'p-'+i },
        context: { environment: 'development', requestedAt: new Date() } }; requests.push(request);
      executions.push(await service.receive(request, 'budget-'+i, () => ({ policyDecision: 'ALLOW', policyReason: 'MATCHED_ALLOW', policyHash: 'a'.repeat(64), policyEvaluatedAt: new Date() })));
    }
    let wait = gate(), pids = new Set();
    const attempts = [randomUUID(), randomUUID()];
    const results = await Promise.allSettled(clients.map((client,i) => new ExecutionsService(synchronized(client,wait,pids),config).claim(identities[i],executions[i].id,undefined,attempts[i])));
    assert.equal(pids.size,2);
    const winner = results.findIndex(r=>r.status==='fulfilled' && r.value===true), loser = 1-winner;
    assert.notEqual(winner,-1); assert.equal(results[loser].status,'rejected');
    assert.equal(results[loser].reason.getResponse().code,'DAILY_REFUND_BUDGET_EXCEEDED');
    let bucket = await db.refundBudgetBucket.findFirstOrThrow({where:scope});
    assert.equal(bucket.reservedMinor,6000); assert.equal(bucket.consumedMinor,0);
    assert.equal(await db.executionAttempt.count({where:scope}),1);
    assert.equal((await service.get(identities[loser],executions[loser].id)).status,'RECEIVED');
    // A known no-effect failure releases exactly once; another agent can use capacity.
    await service.finish(identities[winner],executions[winner].id,{status:'FAILED',errorCode:'CONFIRMED_REJECT'},attempts[winner]);
    assert.equal((await db.refundBudgetBucket.findFirstOrThrow({where:scope})).reservedMinor,0);
    await service.reconcile(identities[winner],executions[winner].id,{status:'FAILED',errorCode:'CONFIRMED_REJECT'});
    assert.equal(await service.claim(identities[loser],executions[loser].id,undefined,attempts[loser]),true);
    await service.finish(identities[loser],executions[loser].id,{status:'OUTCOME_UNKNOWN',errorCode:'TIMEOUT'},attempts[loser]);
    await db.execution.update({where:{id:executions[loser].id},data:{nextRetryAt:new Date(0)}});
    // Competing retries reuse one reservation, never charge the budget twice.
    wait=gate();pids=new Set();
    const retries=[randomUUID(),randomUUID()];
    const claims=await Promise.all(clients.map((client,i)=>new ExecutionsService(synchronized(client,wait,pids),config).claimRetry(identities[loser],executions[loser].id,1,retries[i])));
    assert.equal(pids.size,2);assert.deepEqual(claims.slice().sort(),[false,true]);
    assert.equal((await db.refundBudgetBucket.findFirstOrThrow({where:scope})).reservedMinor,6000);
    const retryId=retries[claims.findIndex(Boolean)];
    // A late attempt cannot release a newer attempt's hold.
    await assert.rejects(service.finish(identities[loser],executions[loser].id,{status:'FAILED',errorCode:'STALE'},attempts[loser]),e=>e.getStatus()===409);
    assert.equal((await db.refundBudgetBucket.findFirstOrThrow({where:scope})).reservedMinor,6000);
    wait=gate();pids=new Set();
    const outcome={status:'SUCCEEDED',result:{simulated:true}};
    const settlements=await Promise.allSettled([
      new ExecutionsService(synchronized(clients[0],wait,pids),config).finish(identities[loser],executions[loser].id,outcome,retryId),
      new ExecutionsService(synchronized(clients[1],wait,pids),config).reconcile(identities[loser],executions[loser].id,outcome),
    ]);
    assert.equal(pids.size,2);
    for(const result of settlements) if(result.status==='rejected') assert.equal(result.reason.getStatus(),409);
    bucket=await db.refundBudgetBucket.findFirstOrThrow({where:scope});
    assert.equal(bucket.reservedMinor,0);assert.equal(bucket.consumedMinor,6000);
    assert.equal((await service.get(identities[loser],executions[loser].id)).status,'SUCCEEDED');
  } finally {
    await db.$transaction([
      db.refundBudgetReservation.deleteMany({where:scope}), db.refundBudgetBucket.deleteMany({where:scope}),
      db.executionAttempt.deleteMany({where:scope}), db.approval.deleteMany({where:scope}), db.execution.deleteMany({where:scope}),
      db.agentCredential.deleteMany({where:scope}), db.agent.deleteMany({where:scope}), db.organization.deleteMany({where:{id:organizationId}}),
    ]);
    await Promise.all(clients.map(client=>client.$disconnect()));
  }
});
