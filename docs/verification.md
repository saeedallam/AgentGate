# Verification — Phase B, 2026-10-02

Base revision: 8bb20c4169e4d61681dbc3f049f6aff3e5a8257c.

Passed in the implementation workspace:
- Prisma 7.10 client generation, TypeScript build and ESLint.
- npm test: 38 tests passed. The foundation HTTP test now generates its own JWT secret and does not depend on a developer .env.
- All five migration SQL files applied to a fresh embedded PostgreSQL (PGlite) database.
- Four integration suites passed: actions-http, execution-model, agent-authentication and agent-credentials-http.
- HTTP tests cover six identical concurrent requests (one execution/attempt), two keys racing on one fake payment, cross-organization and same-organization/different-agent reads, trust-field injection, disabled/production lab, credential revocation and suspension, ambiguous responses, and a simulated failure to save the outcome after the effect.

Limits of this evidence:
- A standalone PostgreSQL/Docker server was unavailable here.
- PGlite's socket multiplexer failed on concurrent prepared statements with the normal pool. Only the temporary compiled PrismaService used for the embedded integration run was restricted to one connection. Source code retains max=10. No PGlite dependency, lab launcher or compiled artifact is committed.
- This validates SQL constraints and application behavior with serialized database access. It does not independently verify multi-connection PostgreSQL locking under contention. Run the committed integration suites on Docker PostgreSQL using docs/phase-b-guide.md.
- The five-file migration chain was executed directly as SQL in the lab; Prisma migrate deploy against Docker remains part of the user's pull/setup verification.
- Real external provider effects, recovery workers, approvals and business policies are outside Phase B.

The earlier execution-model migration and 36 baseline tests had also passed on the developer's Windows/PostgreSQL setup before this change.

## Phase C — 2026-10-08

Base revision: 8682e7e41fe56ebe443e153c73761ce2077198ff.

- 61 ordinary tests passed, including policy HTTP tests with stubbed boundaries
  and a subprocess proving malformed server policy rejects application startup.
- TypeScript build and ESLint passed. No migrations/dependency changes.
- Updated actions-http and execution-model integration suites passed on fresh
  PGlite after applying the five migration SQL files. Policy-blocked receipts
  remained RECEIVED, created no attempts, left fake payments untouched and replayed
  with the same execution ID; changed payload still returned 409.
- First attempt could not reach a separately launched lab. Co-locating the lab
  launcher and test subprocess resolved connectivity.
- As in Phase B, the temporary compiled pool limit was 1; it was restored to 10.
  Source pool remains 10, and no lab files/dependencies are committed. Native
  PostgreSQL multi-connection verification remains a user-side follow-up.
- No live provider, approval workflow, immutable policy-decision history, or
  dynamic/versioned policy administration is claimed. See phase-c-guide.md.


## 2026-10-11 — Phase C decision persistence correction

The release was tested independently of local Phase D approval code. Prisma
validation/generation, 65 ordinary tests and lint passed. Three database suites
(actions HTTP, execution model and policy persistence) passed using all six
release migrations on fresh PGlite with a temporary compiled-only pool size of 1.
This verifies stored decisions/replay/legacy blocking and migration compatibility;
it is not independent-connection native PostgreSQL race verification.
No Approval model, service, approval migration or Phase D tests are in this release.


## 2026-10-11 — Local decision-persistence slice

77 ordinary tests and lint passed. The legacy regression was observed failing
before the fix. Four database integration suites passed on a fresh PGlite instance
with the complete migration chain and a temporary compiled-only pool limit of one.
Coverage includes fixed deny replay after policy changes, one pending approval,
approval-insert rollback, legacy blocking, tenant constraints and HTTP duplicate
requests. This is not native multi-connection PostgreSQL race verification.
Approval HTTP workflow and approved dispatch are unfinished; no claim of full Phase D.

## 2026-10-11 — Local execution immutability

The new database regression failed before the trigger and passed afterwards on
fresh PGlite, testing sixteen protected-field changes, direct SQL, unchanged NULL
resources and progress/result updates. Lint passed. This does not establish native
PostgreSQL multi-connection race behavior. The earlier approval-service fingerprint
regression is still intentionally red pending its implementation; the full local
Phase D ordinary suite is not claimed green.

## 2026-10-12 — Local approval routes

81 ordinary tests and lint passed. The real JWT/HTTP regression failed before
route wiring and passed afterwards. Stored-membership HTTP integration passed on
fresh PGlite with the migration chain and a temporary compiled-only pool size of 1.
Covers safe MEMBER projections, OWNER detail/decision, tenant 404, role spoofing,
strict bodies and repeat-decision conflict. No execution attempt is created by a
decision. Native PostgreSQL concurrent decision/resume testing remains pending.

## 2026-10-12 — Phase D batch 1

87 ordinary tests and lint passed after approved-resume implementation. Eight
integration suites passed on fresh PGlite using all local migrations and a temporary
compiled-only pool max of 1: actions-http, approval-binding, approval-model,
approvals-http, approved-execution, execution-immutability, execution-model and
policy-persistence. This includes concurrent HTTP resumes but not independent
native PostgreSQL connections. No publication or native concurrency claim yet.
New approval INSERT/UPDATE constraints and trigger were verified failing the
mutation regression before migration and passing after it. Trigger migrations
remain essential; Prisma schema generation alone does not install these guards.

## 2026-10-12 — Phase D release candidate

Fresh verification: 87 ordinary tests passed; lint passed. Eight integration suites
passed on fresh PGlite after all nine migrations, with the temporary compiled-only
single-connection pool restored afterwards. No changes to installed dependencies.

Added approval-concurrency.integration.cjs for native independent PostgreSQL sessions:
competing receipt decisions, duplicate pending approvals, competing OWNER decisions
and competing claims. It checks distinct pg_backend_pid() values and aligns writes
with a barrier. This test has not yet run locally: no native PostgreSQL server or
Docker executable is available in this execution environment. The new backend
workflow provisions PostgreSQL 17 and runs it plus the eight existing database
suites. CI results must be checked separately; presence of the workflow is not a pass.

The Postman collection was structurally checked; no manual Postman run is claimed.
Earlier notes above describe historical slices and their then-current limitations.

## Native PostgreSQL verification — 2026-10-12

GitHub Actions run 38282172521 passed for code commit
43f8a9a31a8174674cad2cffebd0404fedb5ef28:
https://github.com/saeedallam/AgentGate/actions/runs/38282172521

The run used Node 24 and a fresh PostgreSQL 17 service. Dependency installation,
Prisma validation/generation, all migrations, ordinary tests, lint and the nine
selected database suites all succeeded. The ninth suite verifies independent
backend sessions and competing receipt/approval/claim transactions. This supersedes
the release candidate's pending native-verification note above. It does not claim
external exactly-once delivery, crash recovery, or a manual Postman run.

## 2026-10-12 — Permanent policy tightening candidate

Observed the new expectation fail against previous code (POLICY_APPROVAL_REQUIRED
instead of a permanent denial). After implementation, 90 ordinary tests and lint
passed. The new tightening integration suite and eight existing suites passed on
fresh PGlite. The backend workflow now includes ten PostgreSQL suites; the native
concurrency suite additionally races denial against claim using distinct backend
sessions and a write barrier. Native CI evidence is checked on the release commit.
No automatic recovery, policy format change or approval reversal is included.

## Phase E local verification — 2026-10-14

- `npm test`: 91 passing ordinary tests (including recovery eligibility).
- `npm run lint`: passed.
- Fresh embedded PostgreSQL/PGlite database: all 12 migrations applied; 10 integration
  suites passed, including HTTP recovery, durable receipts, lost replies, retries,
  stale completion, owner observation after suspension, legacy rejection and forced
  rollback between effect and receipt finalization. Older C/D suites remained green.
- Embedded verification is NOT evidence for independent native backend sessions.
  CI explicitly runs `approval-concurrency.integration.cjs` and
  `recovery-concurrency.integration.cjs` on native PostgreSQL 17. Consult that run's
  result before claiming the native races passed.
- Recovery eligibility test was introduced failing (module absent), then implemented.
- No production database, real payment provider or populated user secrets were used.

## Phase F daily refund budget — 2026-10-15

Local build/lint and 93 ordinary tests passed. The embedded PostgreSQL-compatible
lab passed 12 integration cases (including both budget HTTP/transaction cases).
That lab is not independent-connection concurrency evidence. The backend workflow
adds `refund-budget-concurrency.integration.cjs` alongside existing native races;
inspect the published commit's GitHub Actions run for native PostgreSQL results.

Coverage includes shared-agent cap races, exact boundary, unknown holds, retry
reuse, stale-worker protection, settlement races, claim rollback, safe activation,
configuration drift, UTC bucket rollover, tenant/environment isolation, approval
gating and aggregate monitoring membership. No new external provider is exercised.

## Phases G/H — 2026-10-15

Local verification: 96 ordinary tests, TypeScript build and lint passed; the embedded
PostgreSQL-compatible lab passed 14 integration cases. The new MCP integration uses
an actual SDK client, a compiled stdio subprocess and the real HTTP application.
It is not a manual LLM/client-UI compatibility claim.

The backend workflow now also runs observations.integration.cjs and
mcp-flow.integration.cjs on PostgreSQL 17, alongside the three independent-connection
race suites. Check the published commit's Actions run for native verification.

New coverage: observe without fake dispatch enabled, would-deny/approval/allow,
no execution/attempt/approval/budget/effect writes, OWNER simulation vs MEMBER read,
foreign IDs/cursors, legacy/corrupt history skipping, immutable redacted evidence,
expiry cleanup, frozen live DENY after simulated ALLOW; MCP initialize/list/call,
strict inputs, fixed origins and no redirects, sanitized errors/no automatic retry,
actual HTTP policy/approval/budget/replay/isolation and revoked-key enforcement.

## Dependency and license maintenance — 2026-10-15

Verified locally on Node 24.19.0 after a clean `npm ci` with the new lockfile:

- Full `npm audit --json`: zero reported vulnerabilities (previously six affected entries).
- Resolved Fastify 5.12.7, deepmerge-ts 8.0.2 and mysql2 3.24.6 through scoped overrides.
- Prisma config loading/schema validation and client generation passed with Prisma 7.10.0.
- TypeScript build, all 96 ordinary tests and lint passed.
- All 14 migrations applied in the fresh embedded PostgreSQL-compatible lab;
  14 integration cases passed, including HTTP/MCP, approvals, recovery and budgets.

The embedded lab serializes database connections; it does not establish native
race behavior. The release workflow separately verifies PostgreSQL 17 migrations,
independent-connection race suites and the Docker build. Inspect the exact commit's
Actions run before claiming those checks passed. No Docker daemon or native
PostgreSQL server was available in the local execution environment.

No application schema or authorization behavior was intentionally changed. The MIT
license and package metadata agree. Dependency licenses remain separate. See
[dependency maintenance](dependency-maintenance.md) for compatibility and limits.

## Arabic web console — 2026-10-17

- TypeScript build, 102 ordinary tests and ESLint passed.
- Three jsdom interaction tests cover authentication, tenant switching, foreign-key rejection, ambiguous-response replay and approval decisions without automatic execution.
- All 15 embedded database integration cases passed, including the new console membership, owner/member redaction, cursor isolation and trusted agent identity checks.
- Full dependency audit reports zero vulnerabilities; jsdom is development-only.
- Static asset tests verify the explicit allowlist, CSP, no-store responses and protected data endpoints.
- No browser rendering tool was available: DOM interaction checks are not visual browser QA. Review responsive appearance in a real browser.
- Native PostgreSQL races and the Docker image are verified separately by the Backend verification workflow for the published commit.

See [console guide](console-guide.md) for startup, supported flows and limitations.


## Operational review follow-up — 2026-10-18

Local verification: 108 ordinary tests pass; build, ESLint and Prisma validation
pass. The embedded PostgreSQL-compatible lab passes 16 integration cases, including
expiry triggers, sensitive-read audit failure, owner disablement, separate shared
rate scopes and mid-day/next-day cap behavior. Five final targeted HTTP/DOM tests
also pass after the expiration display and singleton checks. Embedded execution is
not evidence of independent native PostgreSQL races. The release workflow includes
all existing native concurrency tests plus rate-slot and disablement/claim tests.
See `docs/operational-hardening.md` for upgrade behavior and remaining boundaries.
