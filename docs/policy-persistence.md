# Phase C correction: preserve the initial policy decision

New execution receipts save policyDecision, policyReason, policyHash and
policyEvaluatedAt alongside requestHash. All these fields are written together.
A database check rejects partial decision metadata. Existing rows keep NULL
metadata: the migration does not guess historical decisions.

Same organization + agent + idempotency key first reads the existing receipt.
Different normalized payload returns 409. Saved DENY/REQUIRE_APPROVAL stays blocked
even after policy changes to ALLOW. Existing ALLOW also passes a current safety
check before claim; that veto cannot upgrade saved denial. Started/completed
executions replay their stored state without redispatch.

Legacy RECEIVED rows with missing decision metadata return 409,
LEGACY_EXECUTION_REQUIRES_REVIEW. They do not evaluate current rules or dispatch.
Review them explicitly; do not automatically create replacement requests.

Concurrent inserts use the database unique constraint and skipDuplicates. The
loser reads the winner and verifies the request fingerprint. The initial lookup
alone does not provide concurrency protection.

GET returns the original decision metadata. Status RECEIVED describes execution
progress, not policy permission. No approval table, approval endpoints or approved
execution workflow is part of this release; those belong to Phase D.

PolicyHash uses SHA-256 over version 1 and the parsed tenant rule array in stored
order. It is a snapshot identifier, not an archived ruleset or tamper-proof record.
Policies remain startup configuration. All instances must share the same snapshot.
Current safety vetoes are not separately audited in this slice.

## Updating Windows development

Stop the server, then from the project directory with DATABASE_URL targeting the
intended development database:

```cmd
git pull --ff-only
npx prisma migrate deploy
npm run prisma:generate
npm test
npm run lint
```

If pull reports local modifications, inspect and preserve them before retrying;
do not reset or discard the working tree.

In a separate CMD window, set TEST_DATABASE_URL for agentgate_test and apply
migrations there before running database tests:

```cmd
set "DATABASE_URL=%TEST_DATABASE_URL%"
npx prisma migrate deploy
node --test test/policy-persistence.integration.cjs test/actions-http.integration.cjs test/execution-model.integration.cjs
```

No changes to limits, kill switches, env-backed policy administration or recovery
of unfinished external effects are included here. Amounts remain minor currency
units: 5000 USD cents = 50 USD, 50000 = 500 USD. Unconditional ALLOW remains an
explicit broad grant; rule validation behavior is unchanged.
