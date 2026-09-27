# Repository review and verification

Review date: 2026-09-27. Baseline main: 7d094ff8cc9cbeaa42c7aa36b017541154daf8ad.
Runtime: Node v24.19.0. A fresh checkout was used; no developer .env was copied.

## Before changes
- Read AGENTS.md, README, complete src and test files, Prisma schema/config and both
  SQL migrations, package/lockfile setup, Docker/Compose and lint/TS configuration.
- npm ci: passed using the existing lockfile; no dependency versions changed.
- Prisma generation and TypeScript build: passed.
- npm test: 11 passed, 1 failed. Health application startup lacked JWT_ACCESS_SECRET.
- npm run lint: passed.
- Registration database integration test attempted against localhost:5432; failed
  because no PostgreSQL server is available. Cleanup also failed and masked the
  original assertion with a connection error. No successful integration run claimed.
- Docker, postgres and psql executables are unavailable in this environment.

## Small preparation slice after documentation update
- foundation.test.cjs and auth-http.integration.cjs now generate a fresh test-only
  JWT secret before loading the application, matching the other HTTP test files.
- Compose forwards JWT_ACCESS_SECRET to the API. Empty/unset remains invalid under
  application validation; interpolation does not block starting postgres alone.
- No source domain behavior, schema, migration, dependencies or auth defaults changed.

## After changes
- npm test: 12/12 passed, including TypeScript build and real application startup.
- npm run lint: passed.
- prisma validate: passed; Client generated with Prisma 7.10.0.
- git diff --check: passed.
- Live database integration tests and Docker build/start remain unverified here.
  The existing 7 integration files contain 10 cases; run the README command on a
  dedicated migrated agentgate_test database. Unit/HTTP-injection success is not
  evidence of real provider effects, credentials, suspension or execution safety.
- Existing SQL migrations and schema are unchanged. No pivot migration is required.

## Findings to carry forward
1. README/AGENTS progress claims were obsolete; corrected to actual remote features.
2. Remote Agents only supports creation; later get/list work may exist locally and
   must be reconciled, never overwritten. No pretend remote verification of it.
3. No agent credentials/guard/suspension enforcement, execution or audit store exists.
4. In-memory throttling, JWT revocation, application error observability, dependency
   advisories and OpenAPI remain explicit follow-ups, not silently resolved here.
5. Integration cleanup can obscure a primary failure. Improve diagnostics when
   extending the affected fixtures; do not rewrite all tests during the pivot.

Next feature is credential issuance as specified in ADR 0001. This PR deliberately
finishes review/documentation plus the minimal reproducibility repair first.
