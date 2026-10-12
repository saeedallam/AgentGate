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
