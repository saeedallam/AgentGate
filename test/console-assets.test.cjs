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

test("console serves only allowlisted public assets with a strict CSP and leaves monitoring authenticated", async () => {
  const app = await createApplication();
  try {
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    const home = await app.inject({ method: "GET", url: "/" });
    assert.equal(home.headers.location, "/console");
    for (const path of [
      "/console",
      "/console/app.mjs",
      "/console/model.mjs",
      ...require("node:fs")
        .readdirSync("public/console/pages")
        .map((name) => "/console/pages/" + name),
      "/console/styles.css",
      "/console/logo.svg",
      "/console/fonts/dmsans.ttf",
      "/console/fonts/manrope.ttf",
    ]) {
      const result = await app.inject({ method: "GET", url: path });
      assert.equal(result.statusCode, 200, path);
      assert.equal(result.headers["cache-control"], "no-store");
      assert.ok(
        result.headers["content-security-policy"].includes(
          "frame-ancestors 'none'",
        ),
      );
      assert.ok(
        !result.headers["content-security-policy"].includes("unsafe-inline"),
      );
      assert.equal(result.headers["x-content-type-options"], "nosniff");
    }
    for (const path of [
      "/console/pages/missing.mjs",
      "/console/fonts/missing.ttf",
      "/console/%2e%2e/.env",
      "/console/pages/%2e%2e/%2e%2e/.env",
    ]) {
      assert.equal(
        (await app.inject({ method: "GET", url: path })).statusCode,
        404,
      );
    }
    const html = (await app.inject({ method: "GET", url: "/console" })).body;
    assert.match(html, /lang="en" dir="ltr"/);
    assert.equal(
      (await app.inject({ method: "GET", url: "/console/.env" })).statusCode,
      404,
    );
    assert.equal(
      (await app.inject({ method: "GET", url: "/console/unknown.js" }))
        .statusCode,
      404,
    );
    assert.equal(
      (await app.inject({ method: "GET", url: "/v1/console/workspaces" }))
        .statusCode,
      401,
    );
    assert.equal(
      (await app.inject({ method: "GET", url: "/v1/console-agent/identity" }))
        .statusCode,
      401,
    );
  } finally {
    await app.close();
  }
});
