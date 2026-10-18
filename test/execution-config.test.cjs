require("reflect-metadata");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Module } = require("@nestjs/common");
const { NestFactory } = require("@nestjs/core");
const { ConfigService } = require("@nestjs/config");
const {
  ExecutionsService,
} = require("../dist/executions/executions.service.js");
const {
  PrismaService,
} = require("../dist/infrastructure/database/prisma.service.js");

test("execution module refuses startup without its configuration dependency", async () => {
  class MissingConfiguration {}
  Module({
    providers: [ExecutionsService, { provide: PrismaService, useValue: {} }],
  })(MissingConfiguration);
  await assert.rejects(async () => {
    const app = await NestFactory.createApplicationContext(
      MissingConfiguration,
      { logger: false, abortOnError: false },
    );
    await app.close();
  }, /ConfigService|dependencies/);
});

test("execution budgets distinguish explicit empty configuration from missing or invalid values", () => {
  assert.throws(
    () => new ExecutionsService({}, new ConfigService({})),
    /REFUND_BUDGETS_JSON/,
  );
  assert.throws(
    () =>
      new ExecutionsService(
        {},
        new ConfigService({ REFUND_BUDGETS_JSON: "broken" }),
      ),
    /REFUND_BUDGETS_JSON/,
  );
  assert.doesNotThrow(
    () =>
      new ExecutionsService(
        {},
        new ConfigService({ REFUND_BUDGETS_JSON: "[]" }),
      ),
  );
});
