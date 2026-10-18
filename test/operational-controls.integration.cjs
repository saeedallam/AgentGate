require("reflect-metadata");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID, randomBytes } = require("node:crypto");
const url = process.env.TEST_DATABASE_URL;
if (!url || new URL(url).pathname !== "/agentgate_test")
  throw new Error("TEST_DATABASE_URL must target agentgate_test");
Object.assign(process.env, {
  DATABASE_URL: url,
  NODE_ENV: "test",
  LOG_LEVEL: "silent",
  JWT_ACCESS_SECRET: randomBytes(32).toString("hex"),
  POLICY_RULES_JSON: "[]",
  REFUND_BUDGETS_JSON: "[]",
  FAKE_EXECUTION_ENABLED: "true",
  ACTION_ENVIRONMENT: "development",
});
const { createApplication } = require("../dist/bootstrap.js");
const {
  PrismaService,
} = require("../dist/infrastructure/database/prisma.service.js");
const {
  ExecutionsService,
} = require("../dist/executions/executions.service.js");
const { ApprovalsService } = require("../dist/approvals/approvals.service.js");
const {
  AgentKeyService,
} = require("../dist/agent-credentials/agent-key.service.js");
const { JwtService } = require("@nestjs/jwt");
const { actionJson } = require("../dist/executions/action-json.js");
const { ConsoleService } = require("../dist/console/console.service.js");

test(
  "operational controls enforce deadlines, owner disablement, shared throttles and sensitive-read audit",
  { timeout: 45000 },
  async () => {
    const app = await createApplication(),
      db = app.get(PrismaService),
      org = randomUUID(),
      owner = randomUUID(),
      member = randomUUID();
    const scope = { organizationId: org };
    try {
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      await db.organization.create({ data: { id: org, name: "Controls" } });
      for (const [id, role] of [
        [owner, "OWNER"],
        [member, "MEMBER"],
      ]) {
        await db.user.create({
          data: { id, email: id + "@example.test", passwordHash: "unused" },
        });
        await db.organizationMember.create({
          data: { organizationId: org, userId: id, role },
        });
      }
      const agent = await db.agent.create({
          data: { organizationId: org, name: "controls" },
        }),
        key = app.get(AgentKeyService).generate();
      const credential = await db.agentCredential.create({
        data: {
          organizationId: org,
          agentId: agent.id,
          keyPrefix: key.keyPrefix,
          keyHash: key.keyHash,
        },
      });
      const identity = {
        organizationId: org,
        agentId: agent.id,
        credentialId: credential.id,
      };
      const request = {
        organizationId: org,
        principal: { type: "agent", id: agent.id },
        action: { name: "refund.create" },
        arguments: { paymentId: "p", amountMinor: 100, currency: "USD" },
        resource: { type: "payment", id: "p" },
        context: { environment: "development", requestedAt: new Date() },
      };
      const snapshot = {
        policyDecision: "REQUIRE_APPROVAL",
        policyReason: "MATCHED_APPROVAL",
        policyHash: "a".repeat(64),
        policyEvaluatedAt: new Date(),
      };
      const expired = await db.execution.create({
        data: {
          ...scope,
          agentId: agent.id,
          actionName: "refund.create",
          arguments: request.arguments,
          resourceType: "payment",
          resourceId: "p",
          environment: "development",
          requestedAt: request.context.requestedAt,
          requestHash: actionJson(request).hash,
          ...snapshot,
          expiresAt: new Date(0),
        },
      });
      const approval = await db.approval.create({
        data: {
          ...scope,
          executionId: expired.id,
          requestHash: expired.requestHash,
        },
      });
      assert.equal(approval.expiresAt.getTime(), 0);
      await assert.rejects(
        app
          .get(ApprovalsService)
          .decide(owner, approval.id, { decision: "APPROVED" }),
        (e) => e.getStatus() === 409,
      );
      await assert.rejects(
        db.approval.update({
          where: { id: approval.id },
          data: {
            status: "APPROVED",
            decidedByUserId: owner,
            decidedAt: new Date(),
          },
        }),
      );
      await assert.rejects(
        db.execution.update({
          where: { id: expired.id },
          data: { expiresAt: new Date(Date.now() + 86400000) },
        }),
      );
      await assert.rejects(
        db.execution.update({
          where: { id: expired.id },
          data: { status: "EXECUTING" },
        }),
      );
      const executions = app.get(ExecutionsService);
      assert.equal(
        await executions.claim(identity, expired.id, {
          id: approval.id,
          requestHash: expired.requestHash,
        }),
        false,
      );
      const allowed = await executions.receive(request, "fresh", () => ({
        ...snapshot,
        policyDecision: "ALLOW",
      }));
      const consoleService = app.get(ConsoleService);
      assert.ok(
        (await consoleService.execution(owner, org, allowed.id)).arguments,
      );
      assert.equal(
        (await consoleService.execution(member, org, allowed.id)).arguments,
        undefined,
      );
      await app.get(ApprovalsService).get(owner, approval.id);
      const audits = await db.securityAuditEvent.findMany({ where: scope });
      assert.deepEqual(audits.map((x) => x.event).sort(), [
        "APPROVAL_SENSITIVE_READ",
        "CONSOLE_SENSITIVE_READ",
      ]);
      assert.ok(
        audits.every(
          (x) =>
            x.actorUserId === owner && !("arguments" in x) && !("result" in x),
        ),
      );
      const original = db.securityAuditEvent.create;
      db.securityAuditEvent.create = async () => {
        throw new Error("audit unavailable");
      };
      await assert.rejects(
        consoleService.execution(owner, org, allowed.id),
        /audit unavailable/,
      );
      db.securityAuditEvent.create = original;
      const jwt = await app.get(JwtService).signAsync({ sub: owner }),
        memberJwt = await app.get(JwtService).signAsync({ sub: member });
      const base = `/v1/organizations/${org}/agents/${agent.id}`;
      const post = (path, token, payload) =>
        app.inject({
          method: "POST",
          url: path,
          headers: { authorization: "Bearer " + token },
          payload,
        });
      assert.equal(
        (await post(base + "/status", memberJwt, { status: "SUSPENDED" }))
          .statusCode,
        404,
      );
      assert.equal(
        (
          await post(base.replace(org, randomUUID()) + "/status", jwt, {
            status: "SUSPENDED",
          })
        ).statusCode,
        404,
      );
      assert.equal(
        (await post(base + "/status", jwt, { status: "SUSPENDED" })).statusCode,
        201,
      );
      assert.equal(await executions.claim(identity, allowed.id), false);
      assert.equal((await post("/v1/actions", key.apiKey, {})).statusCode, 401);
      assert.equal(
        (await post(base + "/status", jwt, { status: "ACTIVE" })).statusCode,
        201,
      );
      assert.equal(
        (await post(base + `/credentials/${credential.id}/revoke`, jwt, {}))
          .statusCode,
        201,
      );
      assert.equal(await executions.claim(identity, allowed.id), false);
      assert.equal((await post("/v1/actions", key.apiKey, {})).statusCode, 401);
      const replacement = app.get(AgentKeyService).generate();
      await db.agentCredential.create({
        data: {
          ...scope,
          agentId: agent.id,
          keyPrefix: replacement.keyPrefix,
          keyHash: replacement.keyHash,
        },
      });
      // Exhaust only this agent's action window; observe is independently limited.
      await db.requestRateWindow.upsert({
        where: { key: `actions:agent:${org}:${agent.id}` },
        create: {
          key: `actions:agent:${org}:${agent.id}`,
          windowStart: new Date(),
          count: 60,
        },
        update: { count: 60, windowStart: new Date() },
      });
      const throttled = await post("/v1/actions", replacement.apiKey, {});
      assert.equal(throttled.statusCode, 429);
      assert.equal(throttled.headers["retry-after"], "60");
      const observed = await post("/v1/actions/observe", replacement.apiKey, {
        action: request.action,
        arguments: request.arguments,
      });
      assert.equal(observed.statusCode, 200, observed.body);
      await db.requestRateWindow.upsert({
        where: { key: `observe:org:${org}` },
        create: {
          key: `observe:org:${org}`,
          windowStart: new Date(),
          count: 300,
        },
        update: { count: 300, windowStart: new Date() },
      });
      assert.equal(
        (
          await post("/v1/actions/observe", replacement.apiKey, {
            action: request.action,
            arguments: request.arguments,
          })
        ).statusCode,
        429,
      );
      const {
        RefundBudgetLedger,
      } = require("../dist/budgets/refund-budget-ledger.js");
      const {
        utcBudgetDay,
      } = require("../dist/budgets/refund-budget-config.js");
      const rule = {
        organizationId: org,
        environment: "development",
        currency: "USD",
        limitMinor: 1000,
      };
      // Isolate the ledger clock: seed dispatch state in the same transaction as reservation.
      const reserveAt = (ledger, execution, now) =>
        db.$transaction(async (tx) => {
          const started = await tx.execution.update({
            where: { id: execution.id },
            data: { status: "EXECUTING" },
          });
          return ledger.reserve(tx, started, now);
        });
      await reserveAt(new RefundBudgetLedger([rule]), allowed, new Date());
      const second = await executions.receive(
        { ...request, arguments: { ...request.arguments, amountMinor: 200 } },
        "budget-second",
        () => ({ ...snapshot, policyDecision: "ALLOW" }),
      );
      const changedLedger = new RefundBudgetLedger([
        { ...rule, limitMinor: 5000 },
      ]);
      await reserveAt(changedLedger, second, new Date());
      const today = await db.refundBudgetBucket.findFirstOrThrow({
        where: scope,
      });
      assert.equal(today.limitMinor, 1000);
      assert.equal(today.reservedMinor, 300);
      const tomorrow = new Date(utcBudgetDay(new Date()).getTime() + 86400000);
      const third = await executions.receive(
        request,
        "budget-tomorrow",
        () => ({ ...snapshot, policyDecision: "ALLOW" }),
      );
      await reserveAt(changedLedger, third, tomorrow);
      assert.equal(
        (
          await db.refundBudgetBucket.findFirstOrThrow({
            where: { ...scope, day: tomorrow },
          })
        ).limitMinor,
        5000,
      );
      assert.equal(await db.executionAttempt.count({ where: scope }), 0);
    } finally {
      await db.$transaction([
        db.refundBudgetReservation.deleteMany({ where: scope }),
        db.refundBudgetBucket.deleteMany({ where: scope }),
        db.securityAuditEvent.deleteMany({ where: scope }),
        db.requestRateWindow.deleteMany({ where: { key: { contains: org } } }),
        db.policyStudy.deleteMany({ where: scope }),
        db.approval.deleteMany({ where: scope }),
        db.execution.deleteMany({ where: scope }),
        db.agentCredential.deleteMany({ where: scope }),
        db.agent.deleteMany({ where: scope }),
        db.organizationMember.deleteMany({ where: scope }),
        db.organization.deleteMany({ where: { id: org } }),
        db.user.deleteMany({ where: { id: { in: [owner, member] } } }),
      ]);
      await app.close();
    }
  },
);
