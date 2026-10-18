require("reflect-metadata");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  RecoveryMonitoringController,
} = require("../dist/actions/recovery-monitoring.controller.js");
test("owner reconciliation passes the human actor without inventing an agent credential", async () => {
  let forwarded;
  const controller = new RecoveryMonitoringController(
    {
      organizationMember: { findUnique: async () => ({ role: "OWNER" }) },
      execution: { findFirst: async () => ({ agentId: "agent" }) },
    },
    {
      reconcile: async (...args) => {
        forwarded = args;
        return { status: "SUCCEEDED" };
      },
    },
  );
  await controller.reconcile(
    { user: { id: "human" } },
    "organization",
    "execution",
    {},
  );
  assert.deepEqual(forwarded, [
    {
      kind: "owner",
      userId: "human",
      organizationId: "organization",
      agentId: "agent",
    },
    "execution",
    {},
  ]);
  assert.equal(Object.hasOwn(forwarded[0], "credentialId"), false);
});
