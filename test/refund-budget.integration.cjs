require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const url = process.env.TEST_DATABASE_URL;
if (!url || new URL(url).pathname !== '/agentgate_test') throw new Error('TEST_DATABASE_URL must target agentgate_test');
const org = randomUUID(), otherOrg = randomUUID();
const rules = [org, otherOrg].map(organizationId => ({ organizationId, environment: 'development', currency: 'USD', limitMinor: 10000 }));
Object.assign(process.env, { DATABASE_URL: url, NODE_ENV: 'test', LOG_LEVEL: 'silent', JWT_ACCESS_SECRET: randomBytes(32).toString('hex'),
  POLICY_RULES_JSON: '[]', REFUND_BUDGETS_JSON: JSON.stringify(rules), FAKE_EXECUTION_ENABLED: 'true', ACTION_ENVIRONMENT: 'development', FAKE_COMMERCE_SCENARIO: 'success' });
const { createApplication } = require('../dist/bootstrap.js');
const { PrismaService } = require('../dist/infrastructure/database/prisma.service.js');
const { ExecutionsService } = require('../dist/executions/executions.service.js');
const { AgentKeyService } = require('../dist/agent-credentials/agent-key.service.js');
const { PolicyStore } = require('../dist/policies/policy-store.js');
const { ConfigService } = require('@nestjs/config');
const { JwtService } = require('@nestjs/jwt');
const { RefundBudgetLedger } = require('../dist/budgets/refund-budget-ledger.js');
const { utcBudgetDay } = require('../dist/budgets/refund-budget-config.js');

test('daily refund budget gates dispatch, retains unknown holds, settles once and isolates HTTP monitoring', async () => {
  const app = await createApplication(), db = app.get(PrismaService), config = app.get(ConfigService);
  const scope = { organizationId: { in: [org, otherOrg] } }, users = [randomUUID(), randomUUID(), randomUUID()];
  let policy = 'ALLOW';
  try {
    await app.init(); await app.getHttpAdapter().getInstance().ready();
    app.get(PolicyStore).forOrganization = organizationId => [{ organizationId, actionName: 'refund.create', effect: policy, conditions: [] }];
    const identities = [];
    for (const organizationId of [org, org, otherOrg]) {
      await db.organization.upsert({ where: { id: organizationId }, create: { id: organizationId, name: 'Budget lab' }, update: {} });
      const agent = await db.agent.create({ data: { organizationId, name: randomUUID() } });
      const key = app.get(AgentKeyService).generate();
      const credential = await db.agentCredential.create({ data: { organizationId, agentId: agent.id, keyPrefix: key.keyPrefix, keyHash: key.keyHash } });
      identities.push({ organizationId, agentId: agent.id, credentialId: credential.id, apiKey: key.apiKey });
    }
    for (const id of users) await db.user.create({ data: { id, email: id+'@example.test', passwordHash: 'unused' } });
    await db.organizationMember.createMany({ data: [{ organizationId: org, userId: users[0], role: 'OWNER' }, { organizationId: org, userId: users[1], role: 'MEMBER' }] });
    const tokens = await Promise.all(users.map(sub => app.get(JwtService).signAsync({ sub })));
    const send = (path, payload = {}, who = identities[0], key) => app.inject({ method: 'POST', url: path, headers: {
      authorization: 'Bearer '+who.apiKey, ...(key ? { 'idempotency-key': key } : {}),
    }, payload });
    const post = async (name, amountMinor, scenario = 'success', who = identities[0]) => {
      await db.fakePayment.upsert({ where: { organizationId_id: { organizationId: who.organizationId, id: name } },
        create: { organizationId: who.organizationId, id: name, amountMinor: 100000 }, update: {} });
      config.set('FAKE_COMMERCE_SCENARIO', scenario);
      return send('/v1/actions', { action: { name: 'refund.create' }, arguments: { paymentId: name, amountMinor, currency: 'USD' } }, who, name);
    };
    const read = (organizationId = org) => db.refundBudgetBucket.findFirstOrThrow({ where: { organizationId, environment: 'development' } });
    let response = await post('unknown', 6000, 'unknown');
    assert.equal(response.statusCode, 200, response.body);
    const unknown = response.json();
    assert.equal(unknown.status, 'OUTCOME_UNKNOWN');
    assert.equal(unknown.refundBudgetReservation.status, 'HELD');
    assert.equal((await read()).reservedMinor, 6000);
    response = await post('blocked', 4001, 'success', identities[1]);
    assert.equal(response.statusCode, 403, response.body);
    assert.equal(response.json().code, 'DAILY_REFUND_BUDGET_EXCEEDED');
    const blocked = await db.execution.findUniqueOrThrow({ where: { id: response.json().executionId } });
    assert.equal(blocked.status, 'RECEIVED'); assert.equal(blocked.attemptCount, 0);
    assert.equal(await db.executionAttempt.count({ where: { executionId: blocked.id } }), 0);
    assert.equal(await db.fakeProviderReceipt.count({ where: { executionId: blocked.id } }), 0);
    assert.equal((await db.fakePayment.findUniqueOrThrow({ where: { organizationId_id: { organizationId: org, id: 'blocked' } } })).refunded, false);
    response = await send('/v1/executions/'+unknown.id+'/reconcile');
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().status, 'SUCCEEDED');
    await send('/v1/executions/'+unknown.id+'/reconcile');
    assert.equal((await read()).reservedMinor, 0); assert.equal((await read()).consumedMinor, 6000);
    response = await post('failure', 4000, 'reject');
    assert.equal(response.json().status, 'FAILED'); assert.equal(response.json().refundBudgetReservation.status, 'RELEASED');
    assert.equal((await read()).reservedMinor, 0);
    response = await post('retry', 4000, 'timeout');
    const retry = response.json(); assert.equal(retry.status, 'OUTCOME_UNKNOWN');
    assert.equal((await read()).reservedMinor, 4000);
    await db.execution.update({ where: { id: retry.id }, data: { nextRetryAt: new Date(0) } });
    config.set('FAKE_COMMERCE_SCENARIO', 'success');
    response = await send('/v1/executions/'+retry.id+'/retry');
    assert.equal(response.statusCode, 200, response.body); assert.equal(response.json().status, 'SUCCEEDED');
    assert.equal(response.json().attemptCount, 2); assert.equal((await read()).consumedMinor, 10000);
    assert.equal((await read()).reservedMinor, 0);
    response = await post('retry', 4000); // ordinary replay consumes nothing more
    assert.equal(response.json().id, retry.id);
    assert.equal((await read()).consumedMinor, 10000);
    response = await post('other-tenant', 10000, 'success', identities[2]);
    assert.equal(response.statusCode, 200, response.body); assert.equal((await read(otherOrg)).consumedMinor, 10000);
    // Approval is permission, not a budget override. Waiting for approval reserves nothing.
    policy = 'REQUIRE_APPROVAL';
    response = await post('approved-over-budget', 1000);
    const pending = response.json(); assert.equal(pending.approvalStatus, 'PENDING');
    assert.equal(await db.refundBudgetReservation.count({ where: { executionId: pending.executionId } }), 0);
    await db.approval.update({ where: { id: pending.approvalId }, data: { status: 'APPROVED', decidedByUserId: users[0], decidedAt: new Date() } });
    response = await send('/v1/executions/'+pending.executionId+'/resume');
    assert.equal(response.statusCode, 403, response.body); assert.equal(response.json().code, 'DAILY_REFUND_BUDGET_EXCEEDED');
    const budgetUrl = '/v1/organizations/'+org+'/refund-budgets';
    for (const token of tokens.slice(0,2)) {
      const r = await app.inject({ method: 'GET', url: budgetUrl, headers: { authorization: 'Bearer '+token } });
      assert.equal(r.statusCode, 200, r.body); assert.equal(r.json().availableMinor, 0); assert.equal(r.json().timezone, 'UTC');
    }
    assert.equal((await app.inject({ method: 'GET', url: budgetUrl, headers: { authorization: 'Bearer '+tokens[2] } })).statusCode, 404);
    assert.equal((await app.inject({ method: 'GET', url: budgetUrl+'?day=bad', headers: { authorization: 'Bearer '+tokens[0] } })).statusCode, 400);
    assert.equal((await app.inject({ method: 'GET', url: budgetUrl+'?environment=staging', headers: { authorization: 'Bearer '+tokens[0] } })).statusCode, 404);
    // Database binding and counters cannot be silently rewritten.
    await assert.rejects(db.refundBudgetReservation.update({ where: { executionId: retry.id }, data: { amountMinor: 1 } }));
    await assert.rejects(db.refundBudgetReservation.update({ where: { executionId: retry.id }, data: { status: 'RELEASED' } }));
    const bucket = await read();
    const bucketKey = { organizationId: org, environment: bucket.environment, currency: bucket.currency, day: bucket.day };
    await assert.rejects(db.refundBudgetBucket.update({ where: { organizationId_environment_currency_day: bucketKey }, data: { limitMinor: 999999 } }));
    await assert.rejects(db.refundBudgetBucket.update({ where: { organizationId_environment_currency_day: bucketKey }, data: { reservedMinor: 1 } }));
    // Changing config cannot reset today's cap, even on a freshly constructed service.
    policy = 'ALLOW';
    const altered = new ExecutionsService(db, new ConfigService({ REFUND_BUDGETS_JSON: JSON.stringify([{...rules[0], limitMinor: 20000}]) }));
    await assert.rejects(altered.claim(identities[1], blocked.id), e => e.getResponse().code === 'BUDGET_CONFIGURATION_CHANGED');
    // No cap reset at midnight: a new bucket is independent, retries stay tied to original day.
    const tomorrow = new Date(utcBudgetDay(new Date()).getTime()+86400000);
    const ledger = new RefundBudgetLedger(rules);
    await db.$transaction(async tx => {
      const e = await tx.execution.update({ where: { id: blocked.id }, data: { status: 'EXECUTING', attemptCount: 1 } });
      await ledger.reserve(tx, e, tomorrow);
      await ledger.reserve(tx, {...e, attemptCount: 2}, new Date(tomorrow.getTime()+86400000));
    });
    const next = await db.refundBudgetBucket.findFirstOrThrow({ where: { organizationId: org, day: tomorrow } });
    assert.equal(next.reservedMinor, 4001); assert.equal(next.consumedMinor, 0);
    assert.equal(await db.refundBudgetReservation.count({ where: { executionId: blocked.id } }), 1);
    assert.equal((await db.refundBudgetReservation.findUniqueOrThrow({ where: { executionId: blocked.id } })).day.toISOString(), tomorrow.toISOString());
  } finally {
    await db.$transaction([
      db.refundBudgetReservation.deleteMany({ where: scope }), db.refundBudgetBucket.deleteMany({ where: scope }),
      db.fakePayment.deleteMany({ where: scope }), db.executionAttempt.deleteMany({ where: scope }), db.approval.deleteMany({ where: scope }),
      db.execution.deleteMany({ where: scope }), db.agentCredential.deleteMany({ where: scope }), db.agent.deleteMany({ where: scope }),
      db.organizationMember.deleteMany({ where: scope }), db.organization.deleteMany({ where: { id: { in: [org,otherOrg] } } }),
      db.user.deleteMany({ where: { id: { in: users } } }),
    ]);
    await app.close();
  }
});

test('budget reservations roll back with failed claims and activation refuses incomplete history', async () => {
  const db = new PrismaService(new ConfigService({ DATABASE_URL: url }));
  const organizationId = randomUUID(), scope = { organizationId };
  const rule = { organizationId, environment: 'development', currency: 'USD', limitMinor: 10000 };
  const config = new ConfigService({ REFUND_BUDGETS_JSON: JSON.stringify([rule]) });
  try {
    await db.organization.create({ data: { id: organizationId, name: 'Budget activation' } });
    const agent = await db.agent.create({ data: { organizationId, name: 'agent' } });
    const credential = await db.agentCredential.create({ data: { organizationId, agentId: agent.id, keyPrefix: randomUUID(), keyHash: 'unused' } });
    const identity = { organizationId, agentId: agent.id, credentialId: credential.id };
    const service = new ExecutionsService(db, config);
    const request = { organizationId, principal: { type: 'agent', id: agent.id }, action: { name: 'refund.create' },
      arguments: { paymentId: 'p', amountMinor: 1000, currency: 'USD' }, resource: { type: 'payment', id: 'p' },
      context: { environment: 'development', requestedAt: new Date() } };
    const decision = () => ({ policyDecision: 'ALLOW', policyReason: 'MATCHED_ALLOW', policyHash: 'a'.repeat(64), policyEvaluatedAt: new Date() });
    const e = await service.receive(request, 'rollback', decision);
    const broken = new Proxy(db, { get(target,key) {
      if (key === '$transaction') return work => target.$transaction(tx => work(new Proxy(tx, { get(t,k) {
        if (k === 'executionAttempt') return new Proxy(t[k], { get(d,m) { if (m==='create') return async()=>{throw new Error('Injected attempt insert failure');}; return d[m]; } });
        return t[k];
      } })));
      const value=target[key];return typeof value==='function'?value.bind(target):value;
    } });
    await assert.rejects(new ExecutionsService(broken,config).claim(identity,e.id), /Injected attempt insert failure/);
    assert.equal((await service.get(identity,e.id)).status,'RECEIVED');
    assert.equal(await db.executionAttempt.count({where:scope}),0);
    assert.equal(await db.refundBudgetReservation.count({where:scope}),0);
    assert.equal(await db.refundBudgetBucket.count({where:scope}),0);
    // Start a legacy/unbudgeted request, then turn the budget on: no fabricated opening balance.
    const unbudgeted = new ExecutionsService(db,new ConfigService({REFUND_BUDGETS_JSON:'[]'}));
    assert.equal(await unbudgeted.claim(identity,e.id),true);
    await unbudgeted.finish(identity,e.id,{status:'OUTCOME_UNKNOWN',errorCode:'TIMEOUT'});
    const next = await service.receive(request,'new-after-activation',decision);
    await assert.rejects(service.claim(identity,next.id),err=>err.getResponse().code==='BUDGET_BASELINE_REQUIRES_REVIEW');
    await db.execution.update({where:{id:e.id},data:{nextRetryAt:new Date(0)}});
    await assert.rejects(service.claimRetry(identity,e.id,1,randomUUID()),err=>err.getResponse().code==='BUDGET_RESERVATION_MISSING');
    assert.equal(await db.refundBudgetBucket.count({where:scope}),0);
    assert.equal((await service.get(identity,e.id)).attemptCount,1);
    // Definite no-effect resolution permits clean activation.
    await unbudgeted.reconcile(identity,e.id,{status:'FAILED',errorCode:'CONFIRMED_NOT_EXECUTED'});
    assert.equal(await service.claim(identity,next.id),true);
    assert.equal((await db.refundBudgetBucket.findFirstOrThrow({where:scope})).reservedMinor,1000);
    // Removing configuration does not bypass the already-opened daily bucket.
    const tooMuch = await service.receive({...request,arguments:{...request.arguments,amountMinor:10000}},'removed-config',decision);
    await assert.rejects(unbudgeted.claim(identity,tooMuch.id),err=>err.getResponse().code==='DAILY_REFUND_BUDGET_EXCEEDED');
    assert.equal((await service.get(identity,tooMuch.id)).attemptCount,0);
  } finally {
    await db.$transaction([
      db.refundBudgetReservation.deleteMany({where:scope}),db.refundBudgetBucket.deleteMany({where:scope}),
      db.executionAttempt.deleteMany({where:scope}),db.approval.deleteMany({where:scope}),db.execution.deleteMany({where:scope}),
      db.agentCredential.deleteMany({where:scope}),db.agent.deleteMany({where:scope}),db.organization.deleteMany({where:{id:organizationId}}),
    ]);
    await db.$disconnect();
  }
});
