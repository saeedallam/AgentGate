const { test } = require("node:test");
const assert = require("node:assert/strict");
const { policyFingerprint } = require("../dist/policies/policy-fingerprint.js");
const { assertUnexpired } = require("../dist/executions/execution-deadline.js");
test("canonical policy hashes ignore nested object order, retain arrays, and bind values", () => {
  const a = {
    organizationId: "org",
    actionName: "refund.create",
    effect: "ALLOW",
    conditions: [{ field: "arguments.currency", operator: "EQ", value: "USD" }],
  };
  const b = {
    conditions: [{ value: "USD", operator: "EQ", field: "arguments.currency" }],
    effect: "ALLOW",
    actionName: "refund.create",
    organizationId: "org",
  };
  assert.equal(policyFingerprint([a]), policyFingerprint([b]));
  assert.notEqual(
    policyFingerprint([a]),
    policyFingerprint([{ ...a, effect: "DENY" }]),
  );
  assert.notEqual(
    policyFingerprint([a, { ...a, effect: "DENY" }]),
    policyFingerprint([{ ...a, effect: "DENY" }, a]),
  );
});
test("request expiry blocks first dispatch only, never assumes unknown work failed", () => {
  assert.throws(
    () => assertUnexpired({ status: "RECEIVED", expiresAt: new Date(0) }),
    (e) => e.getResponse().code === "EXECUTION_EXPIRED",
  );
  for (const status of ["EXECUTING", "OUTCOME_UNKNOWN", "SUCCEEDED", "FAILED"])
    assert.doesNotThrow(() =>
      assertUnexpired({ status, expiresAt: new Date(0) }),
    );
});
