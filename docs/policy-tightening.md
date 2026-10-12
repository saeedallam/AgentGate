# Permanent denial after policy tightening

## Contract

A RECEIVED execution with an original ALLOW is permanently denied when the current
policy evaluates to DENY or REQUIRE_APPROVAL before claim. Both submit replay and
explicit resume use this rule. They return HTTP 403 / POLICY_TIGHTENED. GET execution
returns the stored state DENIED and its evidence. No approval or attempt is created.
Returning the current policy to ALLOW cannot revive this execution or its key.
Changed payload with the same key still returns 409 before permission evaluation.

Original policyDecision/policyReason/policyHash/policyEvaluatedAt remain immutable.
The additional blockedPolicyDecision, blockedPolicyHash and blockedAt identify the
later veto; errorCode is POLICY_TIGHTENED. The hash identifies, but does not archive,
the parsed startup policy snapshot. This release does not change its hash format.

Initial DENY and initial REQUIRE_APPROVAL retain their existing behavior. An approved
request with original REQUIRE_APPROVAL still uses a current-policy safety veto; this
change does not turn that separate path into permanent denial. Policy configuration
failures remain 503 and do not manufacture a DENIED decision.

## Concurrency boundary

Denial is a conditional UPDATE scoped by execution, organization, agent, RECEIVED
and original ALLOW. Claim already requires RECEIVED. They contend on the same row.
If denial commits first, claim cannot create an attempt. If claim wins, denial
cannot overwrite EXECUTING or pretend the provider was prevented from running.
The caller reads the winner state. A losing allowed claim reports 403 if denial won.
All application instances must still have consistent startup policies. This is not
an atomic global policy reload or cancellation of in-flight external effects.

Two migrations add DENIED to the enum, then add evidence columns, a consistency
check and an update trigger. Separating the enum addition permits PostgreSQL to
commit the new enum value before a later migration uses it in constraints.
The trigger prevents reversing DENIED or replacing its evidence and rejects
retroactive denial of started work. It does not prevent privileged trigger removal
or delete/recreate; application authorization remains required.

## Code map

- src/actions/actions.service.ts: assertSnapshot, evaluatePolicy, assertNotDenied,
  readExecution and denyTightened coordinate the two routes.
- src/executions/executions.service.ts: denyForPolicyTightening performs the atomic
  conditional update without replacing original policy evidence.
- src/executions/execution-state.ts: RECEIVED -> DENIED is allowed; DENIED has no exits.
- src/actions/action-block-code.ts: closed set of response codes.
- src/actions/action-block.ts: one 403 builder with typed additional fields. Core
  response fields are placed last so additional data cannot override them.
- src/policies/policy-reason.ts: constants and a union type for evaluation reasons.
- test/policy-tightening.integration.cjs: both routes, both veto decisions, restored
  ALLOW, unchanged original evidence, no attempts/approvals, payload conflict and
  database rejection of denial mutation.
- test/approval-concurrency.integration.cjs: independent-session barrier races
  between denial and claim in addition to existing approval races.

## Windows

Stop the server and preserve local edits if pull conflicts. With DATABASE_URL
pointing to the development database:

```cmd
git pull --ff-only
npx prisma migrate deploy
npm run prisma:generate
npm test
npm run lint
```

In the test CMD window, set TEST_DATABASE_URL to agentgate_test, then:

```cmd
set "DATABASE_URL=%TEST_DATABASE_URL%"
npx prisma migrate deploy
node --test --test-concurrency=1 test/policy-tightening.integration.cjs test/approval-concurrency.integration.cjs
```

Do not generate a replacement idempotency key automatically to escape denial.
A new key represents a new business request evaluated under current policy.

## Learning notes

`Exclude<PolicyDecision, 'ALLOW'>` accepts only DENY or REQUIRE_APPROVAL for a veto.
`updateMany` returns the number of rows matching the write condition, not permission
based on an earlier read. The later read reports the actual winner's state.
The row's original policyDecision and execution status answer different questions:
what was initially decided, and what ultimately happened to execution.

Scope deliberately excludes changing unconditional ALLOW rules, policy hash formats,
provider identifier formats, pagination or dependency versions.
