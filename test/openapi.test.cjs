const { test } = require("node:test");
const assert = require("node:assert/strict");
process.env.JWT_ACCESS_SECRET = require("node:crypto")
  .randomBytes(32)
  .toString("hex");
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";
process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/test";
process.env.POLICY_RULES_JSON = "[]";
process.env.REFUND_BUDGETS_JSON = "[]";
const { createApplication } = require("../dist/bootstrap.js");
const {
  validateEnvironment,
} = require("../dist/infrastructure/config/environment.js");

async function withApp(enabled, fn) {
  if (enabled === undefined) delete process.env.API_DOCS_ENABLED;
  else process.env.API_DOCS_ENABLED = enabled;
  const app = await createApplication();
  try {
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    await fn(app);
  } finally {
    await app.close();
  }
}

test("OpenAPI documents real guarded operations, strict inputs and local UI assets without credentials", async () => {
  await withApp("true", async (app) => {
    const response = await app.inject("/openapi.json");
    assert.equal(response.statusCode, 200);
    const spec = response.json();
    assert.equal(spec.openapi, "3.0.0");
    const paths = spec.paths;
    let operations = 0;
    for (const [path, item] of Object.entries(paths)) {
      for (const [method, operation] of Object.entries(item)) {
        if (!['get', 'post'].includes(method)) continue;
        operations++;
        if (!path.startsWith('/auth/') && !path.startsWith('/health')) {
          assert.equal(operation.security.length, 1, path);
        }
        if (method === 'post') assert.ok(operation.requestBody, path);
        for (const match of path.matchAll(/\{([^}]+)\}/g)) {
          assert.ok(operation.parameters.some(p => p.in === 'path' && p.name === match[1] && p.required), path);
        }
      }
    }
    assert.ok(operations >= 30);

    assert.deepEqual(paths["/v1/actions"].post.security, [{ agentApiKey: [] }]);
    assert.deepEqual(paths["/v1/approvals/{id}/decision"].post.security, [
      { userJwt: [] },
    ]);
    assert.equal(paths["/auth/login"].post.security, undefined);
    assert.ok(
      !Object.keys(paths).some(
        (path) => path.startsWith("/console") || path === "/",
      ),
    );
    const body =
      paths["/v1/actions"].post.requestBody.content["application/json"].schema;
    assert.equal(body.additionalProperties, false);
    assert.equal(body.properties.arguments.additionalProperties, false);
    assert.deepEqual(body.properties.arguments.properties.currency.enum, [
      "USD",
    ]);
    assert.ok(
      paths["/v1/actions"].post.parameters.some(
        (p) => p.name === "Idempotency-Key" && p.required,
      ),
    );
    const resume = paths["/v1/executions/{id}/resume"].post;
    assert.equal(
      resume.requestBody.content["application/json"].schema
        .additionalProperties,
      false,
    );
    assert.ok(resume.responses["409"]);
    assert.ok(
      paths["/agents"].get.parameters.some(
        (p) => p.name === "organizationId" && p.required,
      ),
    );
    assert.ok(
      paths["/v1/approvals"].get.parameters.some(
        (p) => p.name === "limit" && !p.required,
      ),
    );
    assert.ok(
      paths["/v1/organizations/{organizationId}/policy-simulations"].post
        .requestBody,
    );
    assert.ok(!response.body.includes(process.env.JWT_ACCESS_SECRET));
    assert.ok(!response.body.includes(process.env.DATABASE_URL));
    for (const url of [
      "/docs",
      "/docs/swagger-ui.css",
      "/docs/swagger-ui-bundle.js",
      "/docs/swagger-ui-init.js",
    ]) {
      assert.equal((await app.inject(url)).statusCode, 200, url);
    }
    const init = (await app.inject("/docs/swagger-ui-init.js")).body;
    assert.match(init, /"persistAuthorization": false/);
    assert.match(init, /"validatorUrl": null/);
    assert.equal(
      (await app.inject({ method: "POST", url: "/v1/actions", payload: {} }))
        .statusCode,
      401,
    );
    assert.equal((await app.inject("/v1/approvals")).statusCode, 401);
  });
});

test("documentation is opt-in outside development and explicit false disables all documentation routes", async () => {
  for (const nodeEnv of ["test", "production", "development"]) {
    process.env.NODE_ENV = nodeEnv;
    await withApp(
      nodeEnv === "development" ? "false" : undefined,
      async (app) => {
        for (const url of [
          "/docs",
          "/openapi.json",
          "/docs/swagger-ui-bundle.js",
        ]) {
          assert.equal((await app.inject(url)).statusCode, 404);
        }
      },
    );
  }
  await withApp(undefined, async (app) =>
    assert.equal((await app.inject("/openapi.json")).statusCode, 200),
  );
  process.env.NODE_ENV = "test";
  assert.throws(
    () => validateEnvironment({ ...process.env, API_DOCS_ENABLED: "yes" }),
    /API_DOCS_ENABLED/,
  );
});
