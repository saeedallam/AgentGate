# Phase G — policy observation and historical simulation

This phase introduces **non-executing policy studies**, not an enforcement-off
switch. Existing action routes always enforce policy, approval and budget checks.
An observed/simulated ALLOW is never an authorization token and cannot be supplied
to submit/resume/retry. The service imports neither ActionsService nor a provider.

## Routes

| Route | Identity | Behavior |
| --- | --- | --- |
| POST `/v1/actions/observe` | agent API key | Validate a proposed action, evaluate current server rules, persist redacted would-decision |
| POST `/v1/organizations/:organizationId/policy-simulations` | OWNER JWT | Evaluate candidate policies against up to 100 explicitly selected executions in that organization |
| GET `/v1/organizations/:organizationId/policy-observations` | member JWT | Cursor-paginated study summaries (default 25, maximum 100) |
| GET `/v1/organizations/:organizationId/policy-observations/:id` | member JWT | Redacted evidence for one unexpired study |

Observation body is the same exact action envelope as POST /v1/actions. Client
organization, policies, resource and environment overrides are rejected. It works
when fake execution is disabled because it never calls the provider. No execution,
attempt, approval or budget reservation is created. Repeated observations create
separate study records; they are not idempotent submissions.

```json
{
  "action": {"name": "refund.create"},
  "arguments": {"paymentId": "payment_demo", "amountMinor": 6000, "currency": "USD"}
}
```

Example response fields:

```json
{
  "mode": "OBSERVE",
  "policyOnly": true,
  "executed": false,
  "authorizationGranted": false,
  "summary": {"allow": 0, "deny": 0, "requireApproval": 1, "skipped": 0},
  "results": [{"actionName": "refund.create", "requestHash": "...", "decision": "REQUIRE_APPROVAL", "reason": "MATCHED_APPROVAL"}]
}
```

## Simulation contract

```json
{
  "executionIds": ["YOUR_EXECUTION_UUID"],
  "policies": [{
    "actionName": "refund.create",
    "effect": "ALLOW",
    "conditions": [
      {"field": "arguments.currency", "operator": "EQ", "value": "USD"},
      {"field": "arguments.amountMinor", "operator": "LTE", "value": 10000}
    ]
  }]
}
```

Organization scope comes from the authenticated membership and route. Do not put
organizationId in candidate rules. Candidate rules are validated but never installed
into PolicyStore or written to the enforcement configuration. This is not a policy
administration endpoint.

Every requested execution must be found in the same organization; mixed foreign or
missing IDs reject the whole request with 404. Duplicate IDs or >100 IDs are 400.
The service reconstructs the immutable stored action, verifies its request hash and
checks current registry support. Missing initial policy evidence and unsuitable
history are explicitly skipped, not silently counted as ALLOW or DENY. Other DB or
infrastructure errors are errors, not skipped history.

The report compares the recorded initial policy decision to the candidate's would-
decision on those same arguments and historical environment. It is **policy-only**:
no simulation of daily budget availability, approval state, credential changes,
provider ownership or provider effects. It makes no causal or economic prediction
about what would actually have happened. Sampling is caller-selected, not a claim
of representative history.

## Evidence and retention

PolicyStudy stores actor IDs, organization, mode, policy snapshot hash, counts,
request fingerprints, execution IDs, recorded/candidate decisions and safe reasons.
It never stores raw arguments, payment/customer IDs, API keys, passwords, JWTs or
candidate rule values. Hashes identify evidence; they do not encrypt low-entropy
inputs. Treat study access as sensitive tenant metadata.

Study rows are immutable. They expire after 30 days and expired rows disappear
from the API. Each study write prunes up to 100 expired rows for that tenant.
For idle tenants, the operator must schedule:

```bat
npm run observations:prune
```

One invocation deletes at most 1000 expired rows across tenants. Repeat/schedule
until the backlog is gone. There is no automatic job runner; expiration is a read
filter and deletion requires writes or this cleanup command. Retention of the
original Execution records is a separate existing operational concern.

Cursor queries enforce membership and cursor ownership. MEMBER sees only the same
redacted metadata, never raw execution arguments. All responses use no-store.
Backend body size and batch/page limits bound work per request; general API rate
limiting beyond authentication routes remains a production hardening task.

## Files and tests

- `src/observations/observations.service.ts`: observe, simulate, scope and expiry.
- `src/observations/policy-study.ts`: snapshot hashing and decision counts.
- `src/observations/observations.controller.ts`: agent and JWT route boundaries.
- `prisma/migrations/20261015130000_policy_studies/migration.sql`: evidence store.
- `test/observations.integration.cjs`: HTTP permissions, no effect/approval/budget
  writes, frozen denial after candidate ALLOW, unsuitable history, redaction,
  immutable evidence, expiry and fail-closed policy errors.

Import `docs/AgentGate-Phase-G.postman_collection.json` for manual exploration.
