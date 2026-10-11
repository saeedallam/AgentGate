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
