require("reflect-metadata");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID, randomBytes } = require("node:crypto");
const org = randomUUID();
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";
process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/agentgate_test";
process.env.JWT_ACCESS_SECRET = randomBytes(32).toString("hex");
process.env.FAKE_EXECUTION_ENABLED = "true";
process.env.ACTION_ENVIRONMENT = "development";
const usd = { field: "arguments.currency", operator: "EQ", value: "USD" };
process.env.POLICY_RULES_JSON = JSON.stringify(
  [
    {
      effect: "ALLOW",
      conditions: [
        usd,
        { field: "arguments.amountMinor", operator: "LTE", value: 5000 },
      ],
    },
    {
      effect: "REQUIRE_APPROVAL",
      conditions: [
        usd,
        { field: "arguments.amountMinor", operator: "GT", value: 5000 },
        { field: "arguments.amountMinor", operator: "LTE", value: 50000 },
      ],
    },
    {
      effect: "DENY",
      conditions: [
        usd,
        { field: "arguments.amountMinor", operator: "GT", value: 50000 },
      ],
    },
  ].map((rule) => ({
    ...rule,
    organizationId: org,
    actionName: "refund.create",
  })),
);
const { createApplication } = require("../dist/bootstrap.js");
const {
  AgentAuthenticationService,
} = require("../dist/agent-credentials/agent-authentication.service.js");
const {
  ExecutionsService,
} = require("../dist/executions/executions.service.js");
const {
  FakeCommerceProvider,
} = require("../dist/fake-commerce/fake-commerce.provider.js");
const { PolicyStore } = require("../dist/policies/policy-store.js");

test("HTTP policy responses block dispatch and use authenticated organization", async () => {
  const app = await createApplication();
  let claims = 0;
  let effects = 0;
  let receives = 0;
  let execution;
  const identity = {
    organizationId: org,
    agentId: randomUUID(),
    credentialId: randomUUID(),
  };
  try {
    app.get(
      require("../dist/security/action-rate.guard.js").ActionRateGuard,
    ).canActivate = async () => true;
    app.get(AgentAuthenticationService).authenticate = async () => identity;
    const registry = app.get(
      require("../dist/actions/action-registry.js").ActionRegistry,
    );
    assert.equal(
      app.get(require("../dist/actions/actions.service.js").ActionsService)
        .registry,
      registry,
    );
    assert.equal(
      app.get(
        require("../dist/observations/observations.service.js")
          .ObservationsService,
      ).registry,
      registry,
    );
    const executions = app.get(ExecutionsService);
    executions.receive = async (_request, _key, evaluate) => {
      receives++;
      execution = { id: randomUUID(), status: "RECEIVED", ...evaluate() };
      return execution;
    };
    executions.claim = async () => {
      claims++;
      return true;
    };
    executions.finish = async (_identity, _id, outcome) => ({
      ...execution,
      ...outcome,
    });
    app.get(FakeCommerceProvider).execute = async () => {
      effects++;
      return { status: "SUCCEEDED", result: { simulated: true } };
    };
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    const send = (amountMinor, extra = {}) =>
      app.inject({
        method: "POST",
        url: "/v1/actions",
        headers: {
          authorization: "Bearer test-key",
          "idempotency-key": "test-key",
        },
        payload: {
          action: { name: "refund.create" },
          arguments: {
            paymentId: "payment_demo",
            amountMinor,
            currency: "USD",
          },
          ...extra,
        },
      });
    const allowed = await send(5000);
    assert.equal(allowed.statusCode, 200);
    assert.equal(allowed.json().status, "SUCCEEDED");
    for (const [amount, code] of [
      [5001, "POLICY_APPROVAL_REQUIRED"],
      [50000, "POLICY_APPROVAL_REQUIRED"],
      [50001, "POLICY_DENIED"],
    ]) {
      const reply = await send(amount);
      assert.equal(reply.statusCode, 403);
      assert.equal(reply.json().code, code);
      assert.equal(reply.json().executionId, execution.id);
      assert.equal(reply.headers["cache-control"], "no-store");
    }
    assert.equal(claims, 1);
    assert.equal(effects, 1);
    identity.organizationId = randomUUID();
    assert.equal((await send(5000)).json().code, "POLICY_DENIED");
    const beforeSpoof = receives;
    assert.equal((await send(5000, { organizationId: org })).statusCode, 400);
    assert.equal((await send(5000, { policies: [] })).statusCode, 400);
    assert.equal(receives, beforeSpoof);
    app.get(PolicyStore).forOrganization = () => {
      throw new Error("private rule contents");
    };
    const failure = await send(5000);
    assert.equal(failure.statusCode, 503);
    assert.equal(failure.body.includes("private rule contents"), false);
    assert.equal(claims, 1);
    assert.equal(effects, 1);
  } finally {
    await app.close();
  }
});

test("invalid server policy configuration prevents application startup", () => {
  const { spawnSync } = require("node:child_process");
  const result = spawnSync(
    process.execPath,
    [
      "-e",
      `
    require('./dist/bootstrap.js').createApplication().then(async app => {
      await app.close(); process.exitCode = 2;
    }).catch(error => {
      if (error.name !== 'InvalidPolicyConfigurationError') process.exitCode = 3;
      else console.log(error.message);
    });
  `,
    ],
    {
      cwd: require("node:path").resolve(__dirname, ".."),
      env: {
        ...process.env,
        POLICY_RULES_JSON: '[{"private-config":"secret-value"}]',
      },
      encoding: "utf8",
      timeout: 15000,
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Invalid policy configuration/);
  assert.equal((result.stdout + result.stderr).includes("secret-value"), false);
});
