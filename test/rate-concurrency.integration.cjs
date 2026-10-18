require("reflect-metadata");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const {
  PrismaService,
} = require("../dist/infrastructure/database/prisma.service.js");
const { ConfigService } = require("@nestjs/config");
const { ActionRateGuard } = require("../dist/security/action-rate.guard.js");
const url = process.env.TEST_DATABASE_URL;
if (!url || new URL(url).pathname !== "/agentgate_test")
  throw new Error("TEST_DATABASE_URL must target agentgate_test");
test(
  "independent server connections share the final available rate slot",
  { timeout: 15000 },
  async () => {
    const clients = [0, 1].map(
      () => new PrismaService(new ConfigService({ DATABASE_URL: url })),
    );
    const org = randomUUID(),
      agentId = randomUUID();
    const key = `actions:agent:${org}:${agentId}`;
    try {
      // Seed at 59: exactly one of two concurrent admissions may consume slot 60.
      await clients[0].requestRateWindow.create({
        data: { key, windowStart: new Date(Date.now() + 60000), count: 59 },
      });
      const context = {
        getHandler: () => ({ name: "submit" }),
        switchToHttp: () => ({
          getRequest: () => ({ agent: { organizationId: org, agentId } }),
          getResponse: () => ({ header: () => {} }),
        }),
      };
      const pids = await Promise.all(
        clients.map((db) => db.$queryRaw`SELECT pg_backend_pid() AS pid`),
      );
      assert.notEqual(pids[0][0].pid, pids[1][0].pid);
      const answers = await Promise.allSettled(
        clients.map((db) => new ActionRateGuard(db).canActivate(context)),
      );
      assert.equal(answers.filter((x) => x.status === "fulfilled").length, 1);
      assert.equal(
        answers.find((x) => x.status === "rejected").reason.getStatus(),
        429,
      );
      assert.equal(
        (
          await clients[0].requestRateWindow.findUniqueOrThrow({
            where: { key },
          })
        ).count,
        60,
      );
    } finally {
      await clients[0].requestRateWindow.deleteMany({
        where: { key: { contains: org } },
      });
      await Promise.all(clients.map((db) => db.$disconnect()));
    }
  },
);
