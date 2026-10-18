require("reflect-metadata");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { ApprovalsService } = require("../dist/approvals/approvals.service.js");

function storedFixture(organizationId) {
  const request = {
    organizationId,
    principal: { type: "agent", id: "1243ad83-6e58-4e62-8613-40c830fff17b" },
    action: { name: "refund.create" },
    arguments: { paymentId: "p", amountMinor: 10000, currency: "USD" },
    context: { environment: "development", requestedAt: new Date() },
  };
  const requestHash = require("../dist/executions/action-json.js").actionJson(
    request,
  ).hash;
  return {
    id: "execution-fixture",
    organizationId,
    agentId: request.principal.id,
    actionName: request.action.name,
    arguments: request.arguments,
    resourceType: null,
    resourceId: null,
    environment: "development",
    requestedAt: request.context.requestedAt,
    requestHash,
    status: "RECEIVED",
    policyDecision: "REQUIRE_APPROVAL",
  };
}

test("a MEMBER cannot decide an approval or change its pending state", async () => {
  const userId = "36fa9ca2-6a1f-451e-b6a3-c9289f15b3ba";
  const approval = {
    id: "28adbb71-9622-4c75-a647-19cae93017f0",
    organizationId: "1832bd19-038d-49b8-895e-c45a71a9c606",
    status: "PENDING",
    decidedByUserId: null,
    decidedAt: null,
  };
  let writes = 0;
  let membershipReads = 0;
  const transaction = {
    approval: {
      findUnique: async () => ({ ...approval }),
      updateMany: async ({ data }) => {
        writes++;
        Object.assign(approval, data);
        return { count: 1 };
      },
    },
    organizationMember: {
      findUnique: async ({ where }) => {
        membershipReads++;
        assert.deepEqual(where.organizationId_userId, {
          organizationId: approval.organizationId,
          userId,
        });
        return { role: "MEMBER" };
      },
    },
  };
  const database = { $transaction: async (work) => work(transaction) };
  const service = new ApprovalsService(database);

  await assert.rejects(
    service.decide(userId, approval.id, { decision: "APPROVED" }),
    (error) =>
      typeof error.getStatus === "function" && error.getStatus() === 403,
  );
  assert.equal(membershipReads, 1);
  assert.equal(writes, 0);
  assert.equal(approval.status, "PENDING");
  assert.equal(approval.decidedByUserId, null);
  assert.equal(approval.decidedAt, null);
});

test("an outsider cannot discover whether an approval has been decided", async () => {
  const userId = "36fa9ca2-6a1f-451e-b6a3-c9289f15b3ba";
  const id = "28adbb71-9622-4c75-a647-19cae93017f0";
  const organizationId = "1832bd19-038d-49b8-895e-c45a71a9c606";
  for (const status of ["PENDING", "APPROVED", "REJECTED"]) {
    let writes = 0;
    let reads = 0;
    const tx = {
      approval: {
        findUnique: async () => ({ id, organizationId, status }),
        updateMany: async () => {
          writes++;
          return { count: 1 };
        },
      },
      organizationMember: {
        findUnique: async ({ where }) => {
          reads++;
          assert.deepEqual(where.organizationId_userId, {
            organizationId,
            userId,
          });
          return null;
        },
      },
    };
    const service = new ApprovalsService({
      $transaction: async (work) => work(tx),
    });
    await assert.rejects(
      service.decide(userId, id, { decision: "APPROVED" }),
      (error) =>
        error.getStatus() === 404 && error.message === "Approval not found",
    );
    assert.equal(reads, 1);
    assert.equal(writes, 0);
  }
});

test("an OWNER records a permitted decision with trusted actor and server time", async () => {
  const userId = "36fa9ca2-6a1f-451e-b6a3-c9289f15b3ba";
  const id = "28adbb71-9622-4c75-a647-19cae93017f0";
  const organizationId = "1832bd19-038d-49b8-895e-c45a71a9c606";
  for (const decision of ["APPROVED", "REJECTED"]) {
    const execution = storedFixture(organizationId);
    const approval = {
      id,
      organizationId,
      executionId: execution.id,
      status: "PENDING",
      requestHash: execution.requestHash,
    };
    let writes = 0;
    const tx = {
      approval: {
        findUnique: async () => ({ ...approval }),
        updateMany: async ({ where, data }) => {
          assert.ok(where.expiresAt.gt instanceof Date);
          assert.deepEqual(
            { ...where, expiresAt: undefined },
            { id, organizationId, status: "PENDING", expiresAt: undefined },
          );
          writes++;
          Object.assign(approval, data);
          return { count: 1 };
        },
      },
      organizationMember: {
        findUnique: async ({ where }) => {
          assert.deepEqual(where.organizationId_userId, {
            organizationId,
            userId,
          });
          return { role: "OWNER" };
        },
      },
    };
    const service = new ApprovalsService({
      $transaction: async (work) => work(tx),
    });
    tx.execution = {
      findFirst: async ({ where }) => {
        assert.deepEqual(where, { id: execution.id, organizationId });
        return execution;
      },
    };
    const before = Date.now();
    const result = await service.decide(userId, id, { decision });
    assert.equal(writes, 1);
    assert.equal(approval.status, decision);
    assert.equal(approval.decidedByUserId, userId);
    assert.ok(approval.decidedAt instanceof Date);
    assert.ok(
      approval.decidedAt.getTime() >= before &&
        approval.decidedAt.getTime() <= Date.now(),
    );
    assert.equal(result.status, decision);
    assert.equal(result.decidedByUserId, userId);
    assert.equal(result.executionId, approval.executionId);
    assert.equal(result.decidedAt.getTime(), approval.decidedAt.getTime());
  }
});

test("losing the conditional update returns conflict without an unconditional retry", async () => {
  const userId = "36fa9ca2-6a1f-451e-b6a3-c9289f15b3ba";
  const id = "28adbb71-9622-4c75-a647-19cae93017f0";
  const organizationId = "1832bd19-038d-49b8-895e-c45a71a9c606";
  const execution = storedFixture(organizationId);
  let updateAttempts = 0;
  const tx = {
    approval: {
      findUnique: async () => ({
        id,
        organizationId,
        status: "PENDING",
        executionId: execution.id,
        requestHash: execution.requestHash,
      }),
      updateMany: async ({ where }) => {
        updateAttempts++;
        assert.ok(where.expiresAt.gt instanceof Date);
        assert.deepEqual(
          { ...where, expiresAt: undefined },
          { id, organizationId, status: "PENDING", expiresAt: undefined },
        );
        return { count: 0 };
      },
    },
    execution: { findFirst: async () => execution },
    organizationMember: { findUnique: async () => ({ role: "OWNER" }) },
  };
  const service = new ApprovalsService({
    $transaction: async (work) => work(tx),
  });

  await assert.rejects(
    service.decide(userId, id, { decision: "REJECTED" }),
    (error) => error.getStatus() === 409,
  );
  assert.equal(updateAttempts, 1);
});

test("transaction conflict P2034 becomes 409 without automatic retry", async () => {
  const { Prisma } = require("../dist/generated/prisma/client.js");
  const conflict = new Prisma.PrismaClientKnownRequestError(
    "simulated conflict",
    {
      code: "P2034",
      clientVersion: "test",
    },
  );
  let attempts = 0;
  const database = {
    $transaction: async () => {
      attempts++;
      throw conflict;
    },
  };
  const service = new ApprovalsService(database);
  await assert.rejects(
    service.decide(
      "36fa9ca2-6a1f-451e-b6a3-c9289f15b3ba",
      "28adbb71-9622-4c75-a647-19cae93017f0",
      { decision: "APPROVED" },
    ),
    (error) =>
      error.getStatus() === 409 &&
      error.message === "Concurrent change detected; reload the approval",
  );
  assert.equal(attempts, 1);
});

test("other database and infrastructure errors propagate unchanged", async () => {
  const { Prisma } = require("../dist/generated/prisma/client.js");
  const failures = [
    new Error("simulated connection failure"),
    new Prisma.PrismaClientKnownRequestError("simulated database failure", {
      code: "P2024",
      clientVersion: "test",
    }),
  ];
  for (const failure of failures) {
    const service = new ApprovalsService({
      $transaction: async () => {
        throw failure;
      },
    });
    await assert.rejects(
      service.decide(
        "36fa9ca2-6a1f-451e-b6a3-c9289f15b3ba",
        "28adbb71-9622-4c75-a647-19cae93017f0",
        { decision: "APPROVED" },
      ),
      (error) => error === failure,
    );
  }
});

test("untrusted fields and invalid decisions are rejected before database access", async () => {
  let transactions = 0;
  const service = new ApprovalsService({
    $transaction: async () => {
      transactions++;
      throw new Error("Database must not be accessed");
    },
  });
  const userId = "36fa9ca2-6a1f-451e-b6a3-c9289f15b3ba";
  const id = "28adbb71-9622-4c75-a647-19cae93017f0";
  const invalidBodies = [
    undefined,
    null,
    [],
    {},
    { decision: "PENDING" },
    { decision: "approved" },
    { decision: "APPROVED", role: "OWNER" },
    { decision: "APPROVED", decidedByUserId: userId },
    { decision: "APPROVED", decidedAt: "2026-01-01T00:00:00Z" },
    { decision: "APPROVED", organizationId: id },
    { decision: "APPROVED", requestHash: "a".repeat(64) },
    { decision: "APPROVED", arguments: { amountMinor: 1 } },
  ];
  for (const input of invalidBodies) {
    await assert.rejects(
      service.decide(userId, id, input),
      (error) => error.getStatus() === 400,
    );
  }
  await assert.rejects(
    service.decide(userId, "not-a-uuid", { decision: "APPROVED" }),
    (error) => error.getStatus() === 400,
  );
  assert.equal(transactions, 0);
});

test("an OWNER cannot overwrite or repeat a finalized decision", async () => {
  for (const status of ["APPROVED", "REJECTED"]) {
    for (const decision of ["APPROVED", "REJECTED"]) {
      let writes = 0;
      const tx = {
        approval: {
          findUnique: async () => ({
            id: "28adbb71-9622-4c75-a647-19cae93017f0",
            organizationId: "1832bd19-038d-49b8-895e-c45a71a9c606",
            status,
          }),
          updateMany: async () => {
            writes++;
            return { count: 1 };
          },
        },
        organizationMember: { findUnique: async () => ({ role: "OWNER" }) },
      };
      const service = new ApprovalsService({
        $transaction: async (work) => work(tx),
      });
      await assert.rejects(
        service.decide(
          "36fa9ca2-6a1f-451e-b6a3-c9289f15b3ba",
          "28adbb71-9622-4c75-a647-19cae93017f0",
          { decision },
        ),
        (error) => error.getStatus() === 409,
      );
      assert.equal(writes, 0);
    }
  }
});

test("a missing approval returns 404 without membership lookup or update", async () => {
  const tx = { approval: { findUnique: async () => null } };
  const service = new ApprovalsService({
    $transaction: async (work) => work(tx),
  });
  await assert.rejects(
    service.decide(
      "36fa9ca2-6a1f-451e-b6a3-c9289f15b3ba",
      "28adbb71-9622-4c75-a647-19cae93017f0",
      { decision: "APPROVED" },
    ),
    (error) =>
      error.getStatus() === 404 && error.message === "Approval not found",
  );
});

test("a changed stored payload cannot receive approval even when both saved hashes match", async () => {
  const { actionJson } = require("../dist/executions/action-json.js");
  const organizationId = "1832bd19-038d-49b8-895e-c45a71a9c606";
  const agentId = "1243ad83-6e58-4e62-8613-40c830fff17b";
  const request = {
    organizationId,
    principal: { type: "agent", id: agentId },
    action: { name: "refund.create" },
    resource: { type: "payment", id: "payment_test" },
    arguments: {
      paymentId: "payment_test",
      amountMinor: 10000,
      currency: "USD",
    },
    context: { environment: "development", requestedAt: new Date() },
  };
  const hash = actionJson(request).hash;
  const approval = {
    id: "28adbb71-9622-4c75-a647-19cae93017f0",
    organizationId,
    executionId: "722620e5-a4df-41f5-8349-bbfdab8f6991",
    status: "PENDING",
    requestHash: hash,
  };
  const execution = {
    id: approval.executionId,
    organizationId,
    agentId,
    actionName: "refund.create",
    arguments: { ...request.arguments, amountMinor: 40000 },
    resourceType: "payment",
    resourceId: "payment_test",
    environment: "development",
    requestedAt: request.context.requestedAt,
    requestHash: hash,
    status: "RECEIVED",
    policyDecision: "REQUIRE_APPROVAL",
  };
  let writes = 0;
  const tx = {
    approval: {
      findUnique: async () => approval,
      updateMany: async () => {
        writes++;
        return { count: 1 };
      },
    },
    organizationMember: { findUnique: async () => ({ role: "OWNER" }) },
    execution: { findFirst: async () => execution },
  };
  const service = new ApprovalsService({
    $transaction: async (work) => work(tx),
  });
  await assert.rejects(
    service.decide("36fa9ca2-6a1f-451e-b6a3-c9289f15b3ba", approval.id, {
      decision: "APPROVED",
    }),
    (error) => error.getStatus() === 409,
  );
  assert.equal(writes, 0);
});

test("invalid stored evidence or execution state stops both decisions before any write", async () => {
  const organizationId = "1832bd19-038d-49b8-895e-c45a71a9c606";
  const original = storedFixture(organizationId);
  const cases = [
    null,
    { ...original, requestHash: null },
    { ...original, requestHash: "0".repeat(64) },
    { ...original, resourceType: "payment", resourceId: null },
    { ...original, resourceType: "payment", resourceId: "different" },
    { ...original, arguments: [] },
    { ...original, environment: "production" },
    { ...original, status: "EXECUTING" },
    { ...original, policyDecision: "ALLOW" },
  ];
  for (const execution of cases) {
    for (const decision of ["APPROVED", "REJECTED"]) {
      let writes = 0;
      const tx = {
        approval: {
          findUnique: async () => ({
            id: "28adbb71-9622-4c75-a647-19cae93017f0",
            organizationId,
            executionId: original.id,
            status: "PENDING",
            requestHash: original.requestHash,
          }),
          updateMany: async () => {
            writes++;
            return { count: 1 };
          },
        },
        execution: { findFirst: async () => execution },
        organizationMember: { findUnique: async () => ({ role: "OWNER" }) },
      };
      const service = new ApprovalsService({
        $transaction: async (work) => work(tx),
      });
      await assert.rejects(
        service.decide(
          "36fa9ca2-6a1f-451e-b6a3-c9289f15b3ba",
          "28adbb71-9622-4c75-a647-19cae93017f0",
          { decision },
        ),
        (e) => e.getStatus() === 409,
      );
      assert.equal(writes, 0);
    }
  }
});

test("the reconstructed fingerprint must also match the approval, not only the execution", () => {
  const {
    verifiedActionRequest,
  } = require("../dist/executions/verified-action-request.js");
  const execution = storedFixture("1832bd19-038d-49b8-895e-c45a71a9c606");
  assert.throws(
    () => verifiedActionRequest(execution, "0".repeat(64)),
    (e) =>
      e.getStatus() === 409 &&
      e.getResponse().code === "ACTION_INTEGRITY_MISMATCH",
  );
  const restored = verifiedActionRequest(execution, execution.requestHash);
  assert.deepEqual(restored.arguments, execution.arguments);
  assert.equal(restored.principal.id, execution.agentId);
});
