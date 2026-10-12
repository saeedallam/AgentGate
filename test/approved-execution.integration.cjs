require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const url = process.env.TEST_DATABASE_URL;
if (!url || new URL(url).pathname !== '/agentgate_test') throw new Error('TEST_DATABASE_URL must target agentgate_test');
process.env.DATABASE_URL = url; process.env.NODE_ENV = 'test'; process.env.LOG_LEVEL = 'silent';
process.env.JWT_ACCESS_SECRET = randomBytes(32).toString('hex'); process.env.POLICY_RULES_JSON = '[]';
process.env.FAKE_EXECUTION_ENABLED = 'true'; process.env.ACTION_ENVIRONMENT = 'development'; process.env.FAKE_COMMERCE_SCENARIO = 'success';
const { createApplication } = require('../dist/bootstrap.js');
const { PrismaService } = require('../dist/infrastructure/database/prisma.service.js');
const { ExecutionsService } = require('../dist/executions/executions.service.js');
const { AgentKeyService } = require('../dist/agent-credentials/agent-key.service.js');
const { PolicyStore } = require('../dist/policies/policy-store.js');
const { ConfigService } = require('@nestjs/config');
const { JwtService } = require('@nestjs/jwt');

test('approved stored requests resume once under current policy and never repeat unknown effects', async () => {
  const app = await createApplication();
  const db = app.get(PrismaService);
  const orgs = [randomUUID(), randomUUID()], agents = [randomUUID(), randomUUID(), randomUUID()], userId = randomUUID();
  const scope = { organizationId: { in: orgs } };
  let policy = 'REQUIRE_APPROVAL';
  try {
    await app.init(); await app.getHttpAdapter().getInstance().ready();
    app.get(PolicyStore).forOrganization = organizationId => [{ organizationId, actionName: 'refund.create', effect: policy, conditions: [] }];
    await db.organization.createMany({ data: orgs.map(id => ({ id, name: 'Approved execution' })) });
    await db.user.create({ data: { id: userId, email: userId + '@example.test', passwordHash: 'unused' } });
    await db.organizationMember.create({ data: { organizationId: orgs[0], userId, role: 'OWNER' } });
    const tokens = [], credentials = [];
    for (let i = 0; i < agents.length; i++) {
      const organizationId = orgs[i === 2 ? 1 : 0];
      await db.agent.create({ data: { id: agents[i], organizationId, name: 'agent-' + i } });
      const key = app.get(AgentKeyService).generate(); tokens.push(key.apiKey);
      credentials.push(await db.agentCredential.create({ data: { organizationId, agentId: agents[i], keyPrefix: key.keyPrefix, keyHash: key.keyHash } }));
    }
    const jwt = await app.get(JwtService).signAsync({ sub: userId });
    const send = (path, token, payload, key) => app.inject({ method: 'POST', url: path,
      headers: { authorization: 'Bearer ' + token, ...(key ? { 'idempotency-key': key } : {}) },
      ...(payload !== undefined ? { payload } : {}) });
    const prepare = async name => {
      await db.fakePayment.create({ data: { organizationId: orgs[0], id: name, amountMinor: 50000 } });
      const body = { action: { name: 'refund.create' }, arguments: { paymentId: name, amountMinor: 10000, currency: 'USD' } };
      const response = await send('/v1/actions', tokens[0], body, name);
      assert.equal(response.statusCode, 403, response.body);
      const replay = await send('/v1/actions', tokens[0], body, name);
      assert.equal(replay.json().approvalId, response.json().approvalId);
      return { ...response.json(), body, name };
    };
    const decide = (row, decision = 'APPROVED') => send('/v1/approvals/' + row.approvalId + '/decision', jwt, { decision });
    const resume = (row, token = tokens[0], payload) => send('/v1/executions/' + row.executionId + '/resume', token, payload);
    const pending = await prepare('pending');
    assert.equal((await resume(pending)).statusCode, 403);
    for (const token of [tokens[1], tokens[2]]) assert.equal((await resume(pending, token)).statusCode, 404);
    assert.equal((await resume(pending, jwt)).statusCode, 401);
    assert.equal((await resume(pending, tokens[0], { amountMinor: 40000 })).statusCode, 400);
    assert.equal((await decide(pending)).statusCode, 200);
    policy = 'DENY';
    assert.equal((await resume(pending)).json().code, 'POLICY_DENIED');
    assert.equal(await db.executionAttempt.count({ where: { executionId: pending.executionId } }), 0);
    policy = 'REQUIRE_APPROVAL';
    const replies = await Promise.all(Array.from({ length: 4 }, () => resume(pending)));
    for (const r of replies) assert.equal(r.statusCode, 200, r.body);
    const final = (await resume(pending)).json();
    assert.equal(final.status, 'SUCCEEDED'); assert.equal(final.result.amountMinor, 10000);
    assert.equal(final.attempts.length, 1); assert.equal(final.approval.status, 'APPROVED');
    const payment = await db.fakePayment.findUniqueOrThrow({ where: { organizationId_id: { organizationId: orgs[0], id: 'pending' } } });
    assert.equal(payment.refundExecutionId, pending.executionId);
    policy = 'DENY';
    assert.equal((await resume(pending)).json().status, 'SUCCEEDED');
    policy = 'REQUIRE_APPROVAL';

    const rejected = await prepare('rejected');
    assert.equal((await decide(rejected, 'REJECTED')).statusCode, 200);
    policy = 'ALLOW';
    assert.equal((await resume(rejected)).json().code, 'APPROVAL_REJECTED');
    assert.equal(await db.executionAttempt.count({ where: { executionId: rejected.executionId } }), 0);
    policy = 'REQUIRE_APPROVAL';

    const unknown = await prepare('unknown');
    await decide(unknown);
    app.get(ConfigService).set('FAKE_COMMERCE_SCENARIO', 'unknown');
    assert.equal((await resume(unknown)).json().status, 'OUTCOME_UNKNOWN');
    app.get(ConfigService).set('FAKE_COMMERCE_SCENARIO', 'success');
    const ambiguousReplay = (await resume(unknown)).json();
    assert.equal(ambiguousReplay.status, 'OUTCOME_UNKNOWN'); assert.equal(ambiguousReplay.attempts.length, 1);
    assert.equal((await db.fakePayment.findUniqueOrThrow({ where: { organizationId_id: { organizationId: orgs[0], id: 'unknown' } } })).refunded, true);

    const revoked = await prepare('revoked'); await decide(revoked);
    await db.agentCredential.update({ where: { id: credentials[0].id }, data: { revokedAt: new Date() } });
    assert.equal((await resume(revoked)).statusCode, 401);
    // Simulate revocation AFTER guard authentication: the claim itself must reject.
    const identity = { organizationId: orgs[0], agentId: agents[0], credentialId: credentials[0].id };
    const approval = await db.approval.findUniqueOrThrow({ where: { id: revoked.approvalId } });
    assert.equal(await app.get(ExecutionsService).claim(identity, revoked.executionId,
      { id: approval.id, requestHash: approval.requestHash }), false);
    assert.equal(await db.executionAttempt.count({ where: { executionId: revoked.executionId } }), 0);
  } finally {
    try {
      await db.$transaction([
        db.executionAttempt.deleteMany({ where: scope }), db.approval.deleteMany({ where: scope }), db.execution.deleteMany({ where: scope }),
        db.fakePayment.deleteMany({ where: scope }), db.agentCredential.deleteMany({ where: scope }), db.agent.deleteMany({ where: scope }),
        db.organizationMember.deleteMany({ where: scope }), db.organization.deleteMany({ where: { id: { in: orgs } } }),
        db.user.deleteMany({ where: { id: userId } }),
      ]);
    } finally { await app.close(); }
  }
});
