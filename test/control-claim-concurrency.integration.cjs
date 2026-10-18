require("reflect-metadata");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { ConfigService } = require("@nestjs/config");
const {
  PrismaService,
} = require("../dist/infrastructure/database/prisma.service.js");
const {
  ExecutionsService,
} = require("../dist/executions/executions.service.js");
const {
  AgentControlsController,
} = require("../dist/security/agent-controls.controller.js");
const url = process.env.TEST_DATABASE_URL;
if (!url || new URL(url).pathname !== "/agentgate_test")
  throw new Error("TEST_DATABASE_URL must target agentgate_test");
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

test(
  "committed suspension and revocation win against claims waiting on the same agent lock",
  { timeout: 30000 },
  async () => {
    const clients = [0, 1].map(
      () => new PrismaService(new ConfigService({ DATABASE_URL: url })),
    );
    const [db, claimant] = clients,
      organizationId = randomUUID(),
      userId = randomUUID();
    const config = new ConfigService({ REFUND_BUDGETS_JSON: "[]" }),
      scope = { organizationId };
    try {
      await db.organization.create({
        data: { id: organizationId, name: "Control races" },
      });
      await db.user.create({
        data: {
          id: userId,
          email: userId + "@example.test",
          passwordHash: "unused",
        },
      });
      await db.organizationMember.create({
        data: { organizationId, userId, role: "OWNER" },
      });
      const agent = await db.agent.create({
        data: { organizationId, name: "race" },
      });
      const credential = await db.agentCredential.create({
        data: {
          organizationId,
          agentId: agent.id,
          keyPrefix: randomUUID(),
          keyHash: "unused",
        },
      });
      const identity = {
        organizationId,
        agentId: agent.id,
        credentialId: credential.id,
      };
      for (const operation of ["suspend", "revoke"]) {
        await db.agent.update({
          where: { id: agent.id },
          data: { status: "ACTIVE" },
        });
        const request = {
          organizationId,
          principal: { type: "agent", id: agent.id },
          action: { name: "refund.create" },
          arguments: {
            paymentId: operation,
            amountMinor: 100,
            currency: "USD",
          },
          resource: { type: "payment", id: operation },
          context: { environment: "development", requestedAt: new Date() },
        };
        const execution = await new ExecutionsService(db, config).receive(
          request,
          operation,
          () => ({
            policyDecision: "ALLOW",
            policyReason: "MATCHED_ALLOW",
            policyHash: "a".repeat(64),
            policyEvaluatedAt: new Date(),
          }),
        );
        const locked = deferred(),
          claimEntered = deferred(),
          pids = new Set();
        const controlDb = new Proxy(db, {
          get(target, key) {
            if (key === "$transaction")
              return (work) =>
                target.$transaction(async (tx) => {
                  pids.add(
                    (await tx.$queryRaw`SELECT pg_backend_pid() AS pid`)[0].pid,
                  );
                  const model =
                    operation === "suspend" ? "agent" : "agentCredential";
                  return work(
                    new Proxy(tx, {
                      get(t, k) {
                        if (k === model)
                          return new Proxy(t[k], {
                            get(m, method) {
                              if (method === "update")
                                return async (args) => {
                                  locked.resolve();
                                  await claimEntered.promise;
                                  return m.update(args);
                                };
                              return typeof m[method] === "function"
                                ? m[method].bind(m)
                                : m[method];
                            },
                          });
                        return typeof t[k] === "function" ? t[k].bind(t) : t[k];
                      },
                    }),
                  );
                });
            return typeof target[key] === "function"
              ? target[key].bind(target)
              : target[key];
          },
        });
        const claimDb = new Proxy(claimant, {
          get(target, key) {
            if (key === "$transaction")
              return (work) =>
                target.$transaction(async (tx) => {
                  pids.add(
                    (await tx.$queryRaw`SELECT pg_backend_pid() AS pid`)[0].pid,
                  );
                  return work(
                    new Proxy(tx, {
                      get(t, k) {
                        if (k === "$queryRaw")
                          return (...args) => {
                            claimEntered.resolve();
                            return t.$queryRaw(...args);
                          };
                        return typeof t[k] === "function" ? t[k].bind(t) : t[k];
                      },
                    }),
                  );
                });
            return typeof target[key] === "function"
              ? target[key].bind(target)
              : target[key];
          },
        });
        const controller = new AgentControlsController(controlDb);
        const control =
          operation === "suspend"
            ? controller.status(
                { user: { id: userId } },
                organizationId,
                agent.id,
                { status: "SUSPENDED" },
              )
            : controller.revoke(
                { user: { id: userId } },
                organizationId,
                agent.id,
                credential.id,
                {},
              );
        await locked.promise;
        const claim = new ExecutionsService(claimDb, config).claim(
          identity,
          execution.id,
        );
        await control;
        assert.equal(await claim, false);
        assert.equal(pids.size, 2);
        assert.equal(
          await db.executionAttempt.count({
            where: { executionId: execution.id },
          }),
          0,
        );
      }
    } finally {
      await db.$transaction([
        db.securityAuditEvent.deleteMany({ where: scope }),
        db.executionAttempt.deleteMany({ where: scope }),
        db.execution.deleteMany({ where: scope }),
        db.agentCredential.deleteMany({ where: scope }),
        db.agent.deleteMany({ where: scope }),
        db.organizationMember.deleteMany({ where: scope }),
        db.organization.deleteMany({ where: { id: organizationId } }),
        db.user.deleteMany({ where: { id: userId } }),
      ]);
      await Promise.all(clients.map((db) => db.$disconnect()));
    }
  },
);
