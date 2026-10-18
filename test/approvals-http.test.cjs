require("reflect-metadata");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID, randomBytes } = require("node:crypto");
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";
process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/agentgate_test";
process.env.JWT_ACCESS_SECRET = randomBytes(32).toString("hex");
process.env.POLICY_RULES_JSON = "[]";
const { createApplication } = require("../dist/bootstrap.js");
const {
  PrismaService,
} = require("../dist/infrastructure/database/prisma.service.js");
const { JwtService } = require("@nestjs/jwt");
const { actionJson } = require("../dist/executions/action-json.js");

test("approval HTTP routes enforce JWT, tenant membership, safe monitoring and owner decisions", async () => {
  const app = await createApplication();
  const organizationId = randomUUID(),
    userId = randomUUID(),
    id = randomUUID(),
    executionId = randomUUID();
  const request = {
    organizationId,
    principal: { type: "agent", id: randomUUID() },
    action: { name: "refund.create" },
    arguments: {
      paymentId: "private-payment",
      amountMinor: 10000,
      currency: "USD",
    },
    resource: { type: "payment", id: "private-payment" },
    context: { environment: "development", requestedAt: new Date() },
  };
  const requestHash = actionJson(request).hash;
  const execution = {
    id: executionId,
    organizationId,
    agentId: request.principal.id,
    actionName: request.action.name,
    arguments: request.arguments,
    resourceType: "payment",
    resourceId: "private-payment",
    environment: "development",
    requestedAt: request.context.requestedAt,
    requestHash,
    status: "RECEIVED",
    policyDecision: "REQUIRE_APPROVAL",
    result: { secret: "private-result" },
    errorCode: "private-error",
  };
  const approval = {
    id,
    organizationId,
    executionId,
    requestHash,
    status: "PENDING",
    expiresAt: new Date(Date.now() + 86400000),
    createdAt: new Date(),
    decidedAt: null,
    decidedByUserId: null,
    execution,
  };
  let role = "MEMBER",
    writes = 0,
    detailReads = 0,
    listReads = 0;
  const approvalDb = {
    findUnique: async ({ where }) => (where.id === id ? { ...approval } : null),
    findMany: async ({ where, take, skip, select }) => {
      listReads++;
      assert.equal(where.organizationId, organizationId);
      assert.equal(take, 50);
      assert.equal(skip, 0);
      assert.deepEqual(select.execution.select, {
        actionName: true,
        status: true,
      });
      return [{ ...approval }];
    },
    updateMany: async ({ where, data }) => {
      writes++;
      if (where.status !== approval.status) return { count: 0 };
      Object.assign(approval, data);
      return { count: 1 };
    },
  };
  const membershipDb = {
    findUnique: async ({ where }) => {
      assert.equal(where.organizationId_userId.userId, userId);
      return role &&
        where.organizationId_userId.organizationId === organizationId
        ? { role }
        : null;
    },
  };
  const executionDb = {
    findFirst: async ({ where }) => {
      detailReads++;
      assert.equal(where.id, executionId);
      assert.equal(where.organizationId, organizationId);
      if (where.agent)
        assert.equal(where.agent.organization.members.some.role, "OWNER");
      return execution;
    },
  };
  try {
    const db = app.get(PrismaService);
    db.securityAuditEvent.create = async ({ data }) => data;
    db.approval.findUnique = approvalDb.findUnique;
    db.approval.findMany = approvalDb.findMany;
    db.organizationMember.findUnique = membershipDb.findUnique;
    db.execution.findFirst = executionDb.findFirst;
    db.$transaction = async (work) =>
      work({
        approval: approvalDb,
        execution: executionDb,
        organizationMember: membershipDb,
      });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    const token = await app
      .get(JwtService)
      .signAsync({ sub: userId, role: "OWNER" });
    const send = (url, method = "GET", payload, bearer = token) =>
      app.inject({
        method,
        url,
        headers: bearer ? { authorization: "Bearer " + bearer } : {},
        ...(payload ? { payload } : {}),
      });
    const detailUrl = "/v1/approvals/" + id;
    const decisionUrl = detailUrl + "/decision";
    const listUrl = "/v1/approvals?organizationId=" + organizationId;
    const member = await send(detailUrl);
    assert.equal(member.statusCode, 200);
    const safeKeys = [
      "id",
      "executionId",
      "status",
      "executionStatus",
      "actionName",
      "createdAt",
      "decidedAt",
      "expiresAt",
      "expired",
    ].sort();
    assert.deepEqual(Object.keys(member.json()).sort(), safeKeys);
    assert.equal(member.body.includes("private-"), false);
    assert.equal(member.headers["cache-control"], "no-store");
    assert.equal(detailReads, 0);
    const list = await send(listUrl);
    assert.equal(list.statusCode, 200);
    assert.deepEqual(Object.keys(list.json().items[0]).sort(), safeKeys);
    assert.equal(list.body.includes("private-"), false);
    assert.equal(
      (await send(decisionUrl, "POST", { decision: "APPROVED" })).statusCode,
      403,
    );
    assert.equal(writes, 0);
    for (const url of [detailUrl, listUrl]) {
      assert.equal((await send(url, "GET", undefined, "")).statusCode, 401);
      assert.equal(
        (await send(url, "GET", undefined, "agt_live_invalid")).statusCode,
        401,
      );
    }
    role = null;
    assert.equal((await send(detailUrl)).statusCode, 404);
    assert.equal((await send("/v1/approvals/" + randomUUID())).statusCode, 404);
    assert.equal((await send(listUrl)).statusCode, 404);
    assert.equal(
      (await send(decisionUrl, "POST", { decision: "APPROVED" })).statusCode,
      404,
    );
    assert.equal(listReads, 1);
    role = "OWNER";
    const owner = await send(detailUrl);
    assert.equal(owner.statusCode, 200);
    assert.deepEqual(owner.json().request.arguments, request.arguments);
    assert.equal(Object.hasOwn(owner.json(), "requestHash"), false);
    assert.equal(
      (await send(decisionUrl, "POST", { decision: "APPROVED", role: "OWNER" }))
        .statusCode,
      400,
    );
    assert.equal((await send(listUrl + "&role=OWNER")).statusCode, 400);
    assert.equal((await send(listUrl + "&limit=1000")).statusCode, 400);
    const decided = await send(decisionUrl, "POST", { decision: "APPROVED" });
    assert.equal(decided.statusCode, 200);
    assert.equal(decided.json().status, "APPROVED");
    assert.equal(decided.json().decidedByUserId, userId);
    assert.equal(
      (await send(decisionUrl, "POST", { decision: "REJECTED" })).statusCode,
      409,
    );
    assert.equal(writes, 1);
    role = "MEMBER";
    assert.equal((await send(detailUrl)).json().status, "APPROVED");
  } finally {
    await app.close();
  }
});
