# Phase D — Approvals and exact-action execution

Approval routes use a user
JWT, not an agent API key. Membership/role is read from the database; a role or
organization asserted in a token/body cannot grant access.

| Method | Route | Access |
| --- | --- | --- |
| GET | /v1/approvals?organizationId=UUID&limit=50&offset=0 | OWNER or MEMBER in that organization |
| GET | /v1/approvals/:id | OWNER or MEMBER in the approval organization |
| POST | /v1/approvals/:id/decision | OWNER in the approval organization |

List response: items, limit, offset. Each item and MEMBER detail contain only id,
executionId, status (approval status), executionStatus, actionName, createdAt,
and decidedAt. Neither raw arguments, resource identifiers, provider results,
internal errors, actor IDs nor hashes are monitoring fields. List is summary-only
for both roles. limit defaults to 50 and is at most 100; offset is 0..10000. Offset
pagination is suitable for this demo, not a stable live event feed.

OWNER detail additionally returns request: organizationId, principal, action,
arguments, optional resource and context. The request is reconstructed and its
fingerprint verified before display. Provider result/error and saved hashes are
not exposed through this endpoint. Failure to verify returns a generic 409.

Decision body is exactly {"decision":"APPROVED"} or {"decision":"REJECTED"}.
Extra fields are rejected. The server checks membership, OWNER role, PENDING,
RECEIVED, REQUIRE_APPROVAL and the stored action fingerprint before recording
actor/time and the decision conditionally within a serializable transaction.
Foreign/missing records return 404; MEMBER decisions return 403; repeat decisions
return 409. Infrastructure failures propagate. All successful route responses use
Cache-Control: no-store.

A decision does NOT dispatch an action. Execution remains RECEIVED
and no execution attempt is created. Approved resume and binding immutability are now implemented (see below). Native
PostgreSQL verification commands are below. Per-request read membership
checks do not revoke responses already in flight.

Verification: test/approvals-http.test.cjs uses actual JWT verification and route
handling with database doubles. test/approvals-http.integration.cjs uses stored
users/memberships/actions/approvals and real HTTP injection against a test database.
Neither test proves native multi-connection approval races.


## Explicit approved execution

POST /v1/executions/:id/resume uses the original agent's API key, not a human JWT.
It accepts an absent body or {}, never a new action payload or approval id. The
execution lookup is scoped by id + organizationId + agentId. Another agent in the
same organization also receives 404. A current valid credential of the original
agent may resume; it need not be the original issued key.

RECEIVED work requires a complete initial policy snapshot. Saved DENY stays denied.
Saved REQUIRE_APPROVAL requires a matching APPROVED record with actor/time evidence;
PENDING and REJECTED stay blocked even if current rules allow. Resume reconstructs
and fingerprints the stored action, checks both saved hashes and the binding,
checks current registry compatibility and environment, then evaluates current rules.
Current DENY (including default deny) blocks dispatch. Current REQUIRE_APPROVAL is
satisfied only by the exact stored approval. Policy errors return 503.

The conditional claim rechecks RECEIVED, the exact APPROVED binding/hash, and the
active agent/nonrevoked credential; it creates the attempt in the same transaction.
Only its winner dispatches. Once an attempt starts, repeated resumes return its
stored state, including FAILED/OUTCOME_UNKNOWN, without another provider call.
A provider exception records unknown outcome; an outcome-persistence failure
propagates and does not restart the attempt. A failed claim may return RECEIVED
without an attempt if authorization changed between authentication and claim.

POST /actions replay still does not execute pending approval work. Once approved,
it returns 403 APPROVAL_READY_TO_RESUME with approvalStatus; use the explicit resume
route. Already started/completed POST replays still return the execution as before.
This response is not a promise that current policies will permit resume.

Migration 20261012130000_protect_approval_binding enforces pending insertion bound
to the matching RECEIVED/REQUIRE_APPROVAL receipt and request hash. It freezes
approval id, organization, execution, hash and creation time, keeps final decision/
actor/time immutable, and requires consistent status/actor/time metadata. Existing
composite foreign keys enforce tenant association. Triggers protect ordinary inserts
and updates, not privileged removal of constraints or delete/recreate operations;
there is no approval-delete application endpoint. Human authorization remains in
the service. Approval hashing verification still runs before the human decision.

Policies remain per-process startup snapshots, requiring consistent configuration
across instances; no global atomic policy revocation is claimed. No real external
provider is enabled. An EXECUTING row after a process crash needs investigation;
recovery/reconciliation is Phase E. There is no approval cancellation/reversal or
expiry endpoint in this release. Final decisions are final; a fresh request is a
separate business operation, never a safe substitute for investigating unknown effects.

## Windows verification

Stop the development server. Preserve any local modifications if pull reports a
conflict; do not reset them or blindly pop old stashes.

```cmd
git pull --ff-only
set "DATABASE_URL="
npx prisma migrate deploy
npm run prisma:generate
npm test
npm run lint
```

In a separate CMD window, set TEST_DATABASE_URL to your dedicated agentgate_test
connection, then:

```cmd
set "DATABASE_URL=%TEST_DATABASE_URL%"
npx prisma migrate deploy
node --test --test-concurrency=1 test/approval-concurrency.integration.cjs test/approved-execution.integration.cjs test/approvals-http.integration.cjs test/approval-binding.integration.cjs test/execution-immutability.integration.cjs test/approval-model.integration.cjs test/policy-persistence.integration.cjs test/actions-http.integration.cjs test/execution-model.integration.cjs
```

The concurrency suite creates two Prisma clients and verifies different PostgreSQL
backend process IDs inside the racing transactions. A barrier places both at the
write after their reads. It checks competing receipt decisions, one approval for
concurrent receives, APPROVED versus REJECTED by two owners (one success, one 409),
and a single successful claim/attempt. It is intentionally not an embedded-database
substitute. Fixture cleanup touches only freshly generated test organizations/users.

The GitHub backend workflow runs the same nine suites with PostgreSQL 17, plus
ordinary tests and lint. Verification evidence and limitations are in verification.md.

## Postman walkthrough

Import AgentGate-Phase-D.postman_collection.json. Set collection variables baseUrl,
organizationId, agentApiKey and ownerAccessToken. ownerAccessToken is a user JWT for
an OWNER in that organization; agentApiKey belongs to the original requesting agent.
Optional memberAccessToken is a different user with MEMBER membership in the same
organization. Never put actual credentials in committed collection files.

Configure the demo USD rules with scripts/print-demo-policy.mjs for your organization
in .env (POLICY_RULES_JSON), and restart the server with fake execution enabled,
development environment and success scenario. Seed a fresh payment:

```cmd
node scripts/seed-fake-payment.mjs YOUR_ORGANIZATION_UUID payment_approval_demo 100000
```

Set paymentId=payment_approval_demo and runId to a new value for this walkthrough.
Run the numbered requests in order. Request 1 saves executionId/approvalId into
collection variables; do not create environment variables with the same names that
would shadow them. Expected: pending 403, same approval on replay, OWNER detail,
OWNER decision 200, duplicate decision 409, resume SUCCEEDED and replay one attempt.
10000 means 100.00 USD, not 10000 dollars.

Optional MEMBER requests assert seven summary fields and reject decisions with 403.
They need a real MEMBER user; forged role fields do not create membership. To test
rejection, start with a new payment and runId, create a new approval and change the
decision to REJECTED; resume must return APPROVAL_REJECTED without an attempt.
A repeated run against a previously refunded fake payment can fail with
PAYMENT_ALREADY_REFUNDED; that is a business duplicate, not an approval failure.

The collection is a reproducible manual walkthrough, not a claim that Postman was
operated on your computer. Current-DENY veto and lost-response replay are also
covered by approved-execution.integration.cjs.
