require("reflect-metadata");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID, randomBytes } = require("node:crypto");
const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).pathname !== "/agentgate_test")
  throw new Error("TEST_DATABASE_URL must target agentgate_test");
process.env.DATABASE_URL = databaseUrl;
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";
process.env.JWT_ACCESS_SECRET = randomBytes(32).toString("hex");
process.env.POLICY_RULES_JSON = "[]";
process.env.REFUND_BUDGETS_JSON = "[]";
const { createApplication } = require("../dist/bootstrap.js");
const {
  PrismaService,
} = require("../dist/infrastructure/database/prisma.service.js");
const { JwtService } = require("@nestjs/jwt");
const {
  ExecutionsService,
} = require("../dist/executions/executions.service.js");
const {
  AgentKeyService,
} = require("../dist/agent-credentials/agent-key.service.js");

test("console monitoring scopes workspaces, counts, cursors and owner detail without enabling execution", async () => {
  const app = await createApplication(),
    db = app.get(PrismaService);
  const orgs = [randomUUID(), randomUUID()],
    users = [randomUUID(), randomUUID(), randomUUID()];
  const agents = [randomUUID(), randomUUID()],
    executionIds = [];
  const where = { organizationId: { in: orgs } };
  try {
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    await db.user.createMany({
      data: users.map((id) => ({
        id,
        email: id + "@console.test",
        passwordHash: "private-unused-hash",
      })),
    });
    await db.organization.createMany({
      data: orgs.map((id, i) => ({ id, name: "Console " + i })),
    });
    await db.organizationMember.createMany({
      data: [
        { organizationId: orgs[0], userId: users[0], role: "OWNER" },
        { organizationId: orgs[0], userId: users[1], role: "MEMBER" },
        { organizationId: orgs[1], userId: users[2], role: "OWNER" },
      ],
    });
    await db.agent.createMany({
      data: agents.map((id, i) => ({
        id,
        organizationId: orgs[i],
        name: "console-agent",
      })),
    });
    for (let i = 0; i < 28; i++) {
      const foreign = i === 27,
        organizationId = orgs[foreign ? 1 : 0],
        agentId = agents[foreign ? 1 : 0];
      const request = {
        organizationId,
        principal: { type: "agent", id: agentId },
        action: { name: "refund.create" },
        arguments: {
          paymentId: "private-payment-" + i,
          amountMinor: 10000,
          currency: "USD",
        },
        resource: { type: "payment", id: "private-payment-" + i },
        context: { environment: "development", requestedAt: new Date() },
      };
      const row = await app
        .get(ExecutionsService)
        .receive(request, "console-" + i, () => ({
          policyDecision: "REQUIRE_APPROVAL",
          policyReason: "MATCHED_APPROVAL",
          policyHash: "a".repeat(64),
          policyEvaluatedAt: new Date(),
        }));
      executionIds.push(row.id);
    }
    const tokens = await Promise.all(
      users.map((sub) => app.get(JwtService).signAsync({ sub })),
    );
    const get = (index, path) =>
      app.inject({
        method: "GET",
        url: path,
        headers: { authorization: "Bearer " + tokens[index] },
      });
    const base = "/v1/console/" + orgs[0];
    for (const i of [0, 1]) {
      const workspaces = await get(i, "/v1/console/workspaces");
      assert.equal(workspaces.statusCode, 200);
      assert.deepEqual(
        workspaces.json().items.map((w) => w.id),
        [orgs[0]],
      );
      assert.equal(
        workspaces.json().items[0].role,
        i === 0 ? "OWNER" : "MEMBER",
      );
      const overview = await get(i, base + "/overview");
      assert.equal(overview.statusCode, 200, overview.body);
      assert.equal(overview.json().totalExecutions, 27);
      assert.equal(overview.json().pendingApprovals, 27);
      assert.equal(overview.json().agents, 1);
      assert.equal(overview.body.includes("private-payment"), false);
    }
    const first = await get(1, base + "/executions");
    assert.equal(first.json().items.length, 25);
    const second = await get(
      1,
      base + "/executions?cursor=" + first.json().nextCursor,
    );
    assert.equal(second.json().items.length, 2);
    assert.equal(second.json().nextCursor, null);
    assert.equal(
      new Set([...first.json().items, ...second.json().items].map((x) => x.id))
        .size,
      27,
    );
    assert.equal(
      (await get(0, base + "/executions?cursor=" + executionIds[27]))
        .statusCode,
      404,
    );
    assert.equal(
      (await get(0, base + "/executions?organizationId=" + orgs[1])).statusCode,
      400,
    );
    assert.equal(
      (await get(0, base + "/executions?status=SUCCEEDED")).json().items.length,
      0,
    );
    for (const path of [
      "/overview",
      "/executions",
      "/executions/" + executionIds[0],
    ])
      assert.equal((await get(2, base + path)).statusCode, 404);
    assert.equal(
      (await get(0, base + "/executions/" + executionIds[27])).statusCode,
      404,
    );
    const member = await get(1, base + "/executions/" + executionIds[0]);
    assert.equal(member.statusCode, 200);
    for (const key of [
      "arguments",
      "result",
      "resourceId",
      "requestHash",
      "policyHash",
      "idempotencyKey",
    ])
      assert.equal(Object.hasOwn(member.json(), key), false, key);
    assert.equal(member.body.includes("private-payment"), false);
    const owner = await get(0, base + "/executions/" + executionIds[0]);
    assert.equal(owner.json().arguments.paymentId, "private-payment-0");
    assert.equal(owner.headers["cache-control"], "no-store");
    const key = app.get(AgentKeyService).generate();
    await db.agentCredential.create({
      data: {
        organizationId: orgs[0],
        agentId: agents[0],
        keyPrefix: key.keyPrefix,
        keyHash: key.keyHash,
      },
    });
    const identity = await app.inject({
      method: "GET",
      url: "/v1/console-agent/identity",
      headers: { authorization: "Bearer " + key.apiKey },
    });
    assert.equal(identity.statusCode, 200, identity.body);
    assert.deepEqual(identity.json(), {
      organizationId: orgs[0],
      agentId: agents[0],
    });
    assert.equal(await db.executionAttempt.count({ where }), 0);
    assert.equal(await db.fakeProviderReceipt.count({ where }), 0);
    assert.equal(await db.refundBudgetReservation.count({ where }), 0);
  } finally {
    await db.approval.deleteMany({ where });
    await db.execution.deleteMany({ where });
    await db.agentCredential.deleteMany({ where });
    await db.agent.deleteMany({ where });
    await db.organizationMember.deleteMany({ where });
    await db.organization.deleteMany({ where: { id: { in: orgs } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await app.close();
  }
});
