require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const url = process.env.TEST_DATABASE_URL;
if (!url || new URL(url).pathname !== '/agentgate_test') throw new Error('TEST_DATABASE_URL must target agentgate_test');
process.env.DATABASE_URL = url;
process.env.NODE_ENV = 'test'; process.env.LOG_LEVEL = 'silent';
process.env.JWT_ACCESS_SECRET = randomBytes(32).toString('hex');
process.env.POLICY_RULES_JSON = '[]';
const { createApplication } = require('../dist/bootstrap.js');
const { PrismaService } = require('../dist/infrastructure/database/prisma.service.js');
const { ExecutionsService } = require('../dist/executions/executions.service.js');
const { JwtService } = require('@nestjs/jwt');

test('stored memberships govern approval monitoring and decisions through HTTP', async () => {
  const app = await createApplication();
  const organizationId = randomUUID(), agentId = randomUUID();
  const users = [randomUUID(), randomUUID(), randomUUID()];
  const where = { organizationId };
  const db = app.get(PrismaService);
  try {
    await app.init(); await app.getHttpAdapter().getInstance().ready();
    await db.organization.create({ data: { id: organizationId, name: 'Approval HTTP test' } });
    await db.user.createMany({ data: users.map(id => ({ id, email: id + '@example.test', passwordHash: 'unused-test-fixture' })) });
    await db.organizationMember.createMany({ data: [
      { organizationId, userId: users[0], role: 'OWNER' },
      { organizationId, userId: users[1], role: 'MEMBER' },
    ] });
    await db.agent.create({ data: { id: agentId, organizationId, name: 'http-test' } });
    const request = { organizationId, principal: { type: 'agent', id: agentId },
      action: { name: 'refund.create' }, arguments: { paymentId: 'private-http-payment', amountMinor: 10000, currency: 'USD' },
      resource: { type: 'payment', id: 'private-http-payment' },
      context: { environment: 'development', requestedAt: new Date() } };
    const execution = await app.get(ExecutionsService).receive(request, 'approval-http', () => ({
      policyDecision: 'REQUIRE_APPROVAL', policyReason: 'MATCHED_APPROVAL',
      policyHash: 'a'.repeat(64), policyEvaluatedAt: new Date(),
    }));
    const tokens = await Promise.all(users.map(sub => app.get(JwtService).signAsync({ sub })));
    const endpoint = '/v1/approvals/' + execution.approval.id;
    const send = (token, path = endpoint, method = 'GET', payload) => app.inject({
      method, url: path, headers: { authorization: 'Bearer ' + token }, ...(payload ? { payload } : {}),
    });
    const member = await send(tokens[1]);
    assert.equal(member.statusCode, 200);
    assert.equal(member.body.includes('private-http-payment'), false);
    assert.equal(Object.hasOwn(member.json(), 'request'), false);
    assert.deepEqual(Object.keys(member.json()).sort(), ['id', 'executionId', 'status', 'executionStatus', 'actionName', 'createdAt', 'decidedAt'].sort());
    const listPath = '/v1/approvals?organizationId=' + organizationId;
    const list = await send(tokens[1], listPath);
    assert.equal(list.statusCode, 200);
    assert.equal(list.json().items.length, 1);
    assert.equal(list.body.includes('private-http-payment'), false);
    const owner = await send(tokens[0]);
    assert.equal(owner.statusCode, 200);
    assert.deepEqual(owner.json().request.arguments, request.arguments);
    assert.equal((await send(tokens[2])).statusCode, 404);
    assert.equal((await send(tokens[2], listPath)).statusCode, 404);
    const decisionPath = endpoint + '/decision';
    assert.equal((await send(tokens[1], decisionPath, 'POST', { decision: 'APPROVED' })).statusCode, 403);
    assert.equal((await db.approval.findUniqueOrThrow({ where: { id: execution.approval.id } })).status, 'PENDING');
    const approved = await send(tokens[0], decisionPath, 'POST', { decision: 'APPROVED' });
    assert.equal(approved.statusCode, 200, approved.body);
    assert.equal(approved.json().decidedByUserId, users[0]);
    assert.equal((await send(tokens[0], decisionPath, 'POST', { decision: 'REJECTED' })).statusCode, 409);
    assert.equal((await send(tokens[1])).json().status, 'APPROVED');
    assert.equal(await db.executionAttempt.count({ where }), 0);
    assert.equal((await db.execution.findUniqueOrThrow({ where: { id: execution.id } })).status, 'RECEIVED');
  } finally {
    try {
      await db.$transaction([
        db.approval.deleteMany({ where }), db.execution.deleteMany({ where }), db.agent.deleteMany({ where }),
        db.organizationMember.deleteMany({ where }), db.organization.deleteMany({ where: { id: organizationId } }),
        db.user.deleteMany({ where: { id: { in: users } } }),
      ]);
    } finally { await app.close(); }
  }
});
