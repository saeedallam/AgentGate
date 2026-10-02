require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).pathname !== '/agentgate_test') {
  throw new Error('TEST_DATABASE_URL must target agentgate_test');
}
process.env.DATABASE_URL = databaseUrl;
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.JWT_ACCESS_SECRET = randomBytes(32).toString('hex');
process.env.FAKE_EXECUTION_ENABLED = 'true';
process.env.ACTION_ENVIRONMENT = 'development';
process.env.FAKE_COMMERCE_SCENARIO = 'success';
const { createApplication } = require('../dist/bootstrap.js');
const { PrismaService } = require('../dist/infrastructure/database/prisma.service.js');
const { AgentKeyService } = require('../dist/agent-credentials/agent-key.service.js');
const { ConfigService } = require('@nestjs/config');
const { ExecutionsService } = require('../dist/executions/executions.service.js');

test('action HTTP flow isolates tenants, claims once and preserves ambiguous effects', async () => {
  const app = await createApplication();
  const orgs = [randomUUID(), randomUUID()];
  const agents = [randomUUID(), randomUUID(), randomUUID()];
  let failed = false;
  try {
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    const db = app.get(PrismaService);
    const config = app.get(ConfigService);
    const keys = app.get(AgentKeyService);
    await db.organization.createMany({ data: orgs.map(id => ({ id, name: 'Action test' })) });
    await db.agent.createMany({ data: agents.map((id, i) => ({
      id, organizationId: orgs[i === 1 ? 1 : 0], name: 'agent-' + i,
    })) });
    const secrets = [];
    const credentials = [];
    for (let i = 0; i < agents.length; i++) {
      const key = keys.generate();
      secrets.push(key.apiKey);
      credentials.push(await db.agentCredential.create({ data: {
        organizationId: orgs[i === 1 ? 1 : 0], agentId: agents[i],
        keyPrefix: key.keyPrefix, keyHash: key.keyHash,
      } }));
    }
    async function payment(id, organizationId = orgs[0]) {
      await db.fakePayment.create({ data: { id, organizationId, amountMinor: 10000 } });
    }
    const body = (id = 'payment_ok', amountMinor = 5000) => ({
      action: { name: 'refund.create' }, arguments: { paymentId: id, amountMinor, currency: 'USD' },
    });
    const send = (payload, key, token = secrets[0]) => app.inject({
      method: 'POST', url: '/v1/actions',
      headers: { authorization: 'Bearer ' + token, 'idempotency-key': key }, payload,
    });
    await payment('payment_ok');
    assert.equal((await app.inject({ method: 'POST', url: '/v1/actions', payload: body() })).statusCode, 401);
    assert.equal((await send(body(), 'invalid-auth', 'bad')).statusCode, 401);
    assert.equal((await send({ ...body(), organizationId: orgs[1] }, 'spoof')).statusCode, 400);
    assert.equal((await send({ ...body(), context: { environment: 'development' } }, 'spoof-context')).statusCode, 400);
    assert.equal((await send({ action: { name: 'unknown' }, arguments: {} }, 'bad-action')).statusCode, 400);
    assert.equal((await send(body('payment_ok', -1), 'bad-amount')).statusCode, 400);
    assert.equal((await app.inject({ method: 'POST', url: '/v1/actions',
      headers: { authorization: 'Bearer ' + secrets[0] }, payload: body() })).statusCode, 400);
    assert.equal(await db.execution.count({ where: { organizationId: { in: orgs } } }), 0);

    const replies = await Promise.all(Array.from({ length: 6 }, () => send(body(), 'same-request')));
    replies.forEach(r => assert.equal(r.statusCode, 200));
    const ids = new Set(replies.map(r => r.json().id));
    assert.equal(ids.size, 1);
    const id = replies[0].json().id;
    const final = await send(body(), 'same-request');
    assert.equal(final.json().status, 'SUCCEEDED');
    assert.equal(final.json().attempts.length, 1);
    assert.equal(final.headers['cache-control'], 'no-store');
    assert.equal(Object.hasOwn(final.json(), 'requestHash'), false);
    assert.equal((await send(body('payment_ok', 6000), 'same-request')).statusCode, 409);
    const duplicate = await send(body(), 'different-request');
    assert.equal(duplicate.json().errorCode, 'PAYMENT_ALREADY_REFUNDED');
    for (const token of [secrets[1], secrets[2]]) {
      const hidden = await app.inject({ method: 'GET', url: '/v1/executions/' + id,
        headers: { authorization: 'Bearer ' + token } });
      assert.equal(hidden.statusCode, 404);
    }
    const foreign = await send(body(), 'foreign-resource', secrets[1]);
    assert.equal(foreign.json().errorCode, 'PAYMENT_NOT_FOUND');
    await payment('payment_unknown');
    config.set('FAKE_COMMERCE_SCENARIO', 'unknown');
    const unknown = await send(body('payment_unknown'), 'unknown');
    assert.equal(unknown.json().status, 'OUTCOME_UNKNOWN');
    assert.equal((await db.fakePayment.findUniqueOrThrow({
      where: { organizationId_id: { organizationId: orgs[0], id: 'payment_unknown' } },
    })).refunded, true);
    config.set('FAKE_COMMERCE_SCENARIO', 'success');
    const replay = await send(body('payment_unknown'), 'unknown');
    assert.equal(replay.json().id, unknown.json().id);
    assert.equal(replay.json().status, 'OUTCOME_UNKNOWN');
    assert.equal(replay.json().attempts.length, 1);
    for (const [scenario, expected] of [['reject', 'FAILED'], ['error', 'OUTCOME_UNKNOWN'], ['timeout', 'OUTCOME_UNKNOWN'], ['delayed', 'SUCCEEDED']]) {
      await payment('payment_' + scenario);
      config.set('FAKE_COMMERCE_SCENARIO', scenario);
      const response = await send(body('payment_' + scenario), scenario);
      assert.equal(response.statusCode, 200);
      assert.equal(response.json().status, expected);
    }
    // Different keys racing on the same payment still produce one fake effect.
    await payment('payment_race');
    config.set('FAKE_COMMERCE_SCENARIO', 'success');
    const race = await Promise.all(['race-a', 'race-b'].map(key => send(body('payment_race'), key)));
    assert.deepEqual(race.map(r => r.json().status).sort(), ['FAILED', 'SUCCEEDED']);
    assert.equal(race.find(r => r.json().status === 'FAILED').json().errorCode, 'PAYMENT_ALREADY_REFUNDED');

    // If saving the outcome fails, replay must not dispatch again.
    await payment('payment_save_failure');
    const storage = app.get(ExecutionsService);
    const finish = storage.finish.bind(storage);
    storage.finish = async () => { throw new Error('Simulated database failure'); };
    try {
      assert.equal((await send(body('payment_save_failure'), 'save-failure')).statusCode, 500);
    } finally { storage.finish = finish; }
    const unfinished = await send(body('payment_save_failure'), 'save-failure');
    assert.equal(unfinished.json().status, 'EXECUTING');
    assert.equal(unfinished.json().attempts.length, 1);
    assert.equal(unfinished.json().attempts[0].finishedAt, null);
    assert.equal((await db.fakePayment.findUniqueOrThrow({ where: {
      organizationId_id: { organizationId: orgs[0], id: 'payment_save_failure' },
    } })).refunded, true);

    config.set('FAKE_EXECUTION_ENABLED', false);
    assert.equal((await send(body(), 'disabled')).statusCode, 503);
    config.set('FAKE_EXECUTION_ENABLED', true);
    config.set('ACTION_ENVIRONMENT', 'production');
    assert.equal((await send(body(), 'production')).statusCode, 503);
    config.set('ACTION_ENVIRONMENT', 'development');
    config.set('NODE_ENV', 'production');
    assert.equal((await send(body(), 'node-production')).statusCode, 503);
    config.set('NODE_ENV', 'test');
    await db.agent.update({ where: { id: agents[0] }, data: { status: 'SUSPENDED' } });
    assert.equal((await send(body(), 'suspended')).statusCode, 401);
    await db.agent.update({ where: { id: agents[0] }, data: { status: 'ACTIVE' } });
    await db.agentCredential.update({ where: { id: credentials[0].id }, data: { revokedAt: new Date() } });
    assert.equal((await send(body(), 'revoked')).statusCode, 401);
    // A credential revoked after authentication must not claim pending work.
    const pending = await db.execution.create({ data: {
      organizationId: orgs[0], agentId: agents[0], actionName: 'refund.create',
      arguments: body().arguments, environment: 'development', requestedAt: new Date(),
    } });
    assert.equal(await app.get(ExecutionsService).claim({
      organizationId: orgs[0], agentId: agents[0], credentialId: credentials[0].id,
    }, pending.id), false);
  } catch (error) { failed = true; throw error; }
  finally {
    try {
      const db = app.get(PrismaService);
      const where = { organizationId: { in: orgs } };
      await db.$transaction([
        db.executionAttempt.deleteMany({ where }), db.execution.deleteMany({ where }),
        db.fakePayment.deleteMany({ where }), db.agentCredential.deleteMany({ where }),
        db.agent.deleteMany({ where }), db.organization.deleteMany({ where: { id: { in: orgs } } }),
      ]);
    } catch (error) { if (!failed) throw error; console.error('Cleanup also failed', error); }
    finally { await app.close(); }
  }
});
