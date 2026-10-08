# Phase C — policies and dispatch gating

## Server policy source (parts 1 and 2)

The pure PolicyEngine validates rules and evaluates normalized ActionRequest values.
PoliciesModule loads PolicyStore eagerly at application startup. The store parses
POLICY_RULES_JSON from server configuration; an absent setting defaults to [].
Invalid JSON or invalid rules abort initialization with a generic error that does
not echo policy contents. There is no permissive fallback for malformed rules.

Rules are a startup snapshot grouped by exact organization UUID. Readers receive
deep copies so nested edits cannot mutate the snapshot. Rules must never be taken
from action request bodies. The caller must use the authenticated organization;
the engine also compares each rule's organization with the normalized request.

Use a single-quoted JSON string in .env, for example (replace the example UUID):

```dotenv
POLICY_RULES_JSON='[{"organizationId":"00000000-0000-4000-8000-000000000001","actionName":"refund.create","effect":"ALLOW","conditions":[{"field":"arguments.currency","operator":"EQ","value":"USD"},{"field":"arguments.amountMinor","operator":"LTE","value":5000}]}]'
```

This is an example only; no grant is installed automatically. Do not commit actual
organization configuration. Restart the application after changing configuration,
and keep identical configuration across application instances. There is no live
reload, management API, database policy table, revisioning or approval workflow.

Conditions support EQ, NEQ, GT, GTE, LT, LTE, IN, NOT_IN and EXISTS. Field access is
limited to direct own arguments keys, principal.id, resource.type, resource.id,
and context.environment. No arbitrary nested traversal or executable expressions.
All conditions must match. Empty conditions deliberately match every normalized
request within the rule's exact organization and action. Missing fields fail
ordinary comparisons; EXISTS distinguishes undefined from present, including null.
No numeric coercion is performed. Limits: 262144 config characters, 1000 rules,
32 conditions per rule, 100 membership values. These are initial defensive bounds.

## Dispatch gate (part 3)

ActionsService now receives the normalized request first, preserving idempotency
and changed-payload 409 semantics. A record no longer in RECEIVED is returned as
stored without policy reevaluation or a new dispatch. For RECEIVED, the service
selects rules with the trusted request organization and evaluates before claim.
Only ALLOW reaches the atomic claim and provider. Configuration/evaluation failure
returns generic 503 and never falls back to execution.

DENY and REQUIRE_APPROVAL return 403 with code POLICY_DENIED or
POLICY_APPROVAL_REQUIRED, decision and executionId. Neither creates an attempt.
The execution remains RECEIVED: no effect was attempted and no approval record
was created. GET reports that receipt state, not a persisted policy decision.
A retry is reevaluated against the current startup snapshot; after an operator
changes policy and restarts, a previously blocked receipt may be allowed. This
is not human approval, automatic approval, or an immutable authorization record.
No decision history/version is persisted yet. Those are explicit current limits.

A snapshot cannot cancel work already claimed. All running instances must use
the same configuration; rolling configuration changes are not an atomic policy
revocation mechanism. Real-provider execution remains disabled by the fake-lab
boundary. See verification and delivery instructions below.

The existing Phase B database integration test now installs explicit ALLOW rules
for its generated organizations so its concurrency/provider scenarios retain their
original purpose. That suite requires a separately migrated agentgate_test DB.


## Pull and verify on Windows CMD

Stop the server, then run:

```cmd
git pull --ff-only
npm test
npm run lint
```

No dependencies, Prisma schema changes or migrations were added by Phase C.
Preserve unrelated local changes. If Git reports a file conflict, resolve it;
do not reset or discard your existing work.

The ordinary suite includes HTTP policy tests with stubbed authentication/storage
and provider boundaries. To verify real storage and concurrency separately, in a
separate CMD window targeting the existing dedicated test database:

```cmd
set "TEST_DATABASE_URL=postgresql://agentgate:local-development-only@localhost:5432/agentgate_test"
set "DATABASE_URL=%TEST_DATABASE_URL%"
npx prisma migrate deploy
node --test test/actions-http.integration.cjs test/execution-model.integration.cjs
```

Use your own local DB credentials if different. The integration suite generates its
own organizations, policies, credentials and payments, then removes its fixtures.

## Configure and exercise the fake demo

1. Run `node scripts/print-demo-policy.mjs YOUR_ORGANIZATION_UUID`.
2. Copy the printed single-line POLICY_RULES_JSON assignment into your local .env,
   replacing any previous assignment. The command prints only; it does not write
   configuration. Do not run the output as a CMD command. Do not commit local .env.
3. In the development server CMD, clear any stale overrides and enable the lab:

```cmd
set "DATABASE_URL="
set "POLICY_RULES_JSON="
set "NODE_ENV=development"
set "ACTION_ENVIRONMENT=development"
set "FAKE_EXECUTION_ENABLED=true"
set "FAKE_COMMERCE_SCENARIO=success"
node scripts/seed-fake-payment.mjs YOUR_ORGANIZATION_UUID payment_policy 100000
npm start
```

The fake payment has USD 1000 so policy limits can be tested without a smaller
payment balance masking them. Use a fresh payment ID if this one exists; the seed
script deliberately never resets an existing refunded payment.

4. Import docs/AgentGate-Phase-C.postman_collection.json. Set baseUrl,
   agentApiKey (locally only), paymentId and runId. The key must belong to the
   configured organization. Check environment variables do not shadow collection
   values with old payment IDs. No JWT is used for these action requests.
5. The three requests expect USD 50 -> 200/SUCCEEDED, USD 50.01 ->
   403/POLICY_APPROVAL_REQUIRED, USD 500.01 -> 403/POLICY_DENIED.
   The blocked requests never reach the provider, even if the allow request already
   refunded the payment. Each case uses a different idempotency key.
6. Repeat a request with the same key/body to inspect replay. Changed payload with
   the same key is 409. Use a new payment ID and runId for a genuinely new demo.

GET /v1/executions/:id still uses the same agent key. Policy-blocked receipts show
RECEIVED and no attempts, not an approval workflow state. Future approval binding,
immutable decision records and policy revisions require further implementation.

## Verification, 2026-10-08

- Build and ESLint passed; 61 ordinary tests passed.
- HTTP checks cover approval/deny codes, no-store, trusted identity scope, body
  spoof rejection, unavailable evaluation and startup failure on malformed policy.
- Updated actions-http and execution-model integration suites passed on PGlite
  with serialized access. A temporary compiled-only pool limit of 1 was restored
  afterward; source remains max=10. No embedded DB dependency is added.
- Native multi-connection PostgreSQL was unavailable in this workspace. Run the
  two committed suites on your PostgreSQL instance; embedded results do not prove
  multi-connection locking behavior. Earlier user-reported Phase B PostgreSQL
  success does not establish verification of this Phase C change.
