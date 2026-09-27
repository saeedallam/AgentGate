# AgentGate

**Runtime Action Safety Layer for AI Agents.**

AI proposes the action. AgentGate decides whether that exact action is allowed,
under what conditions, and coordinates safe execution with auditable evidence.
The initial niche is customer-support agents performing refund and account actions.
MCP is deferred as one adapter; it is not the core product.

## Actual implementation
Reviewed baseline: `7d094ff8cc9cbeaa42c7aa36b017541154daf8ad`.

| Implemented | Behavior |
| --- | --- |
| NestJS 11 / Fastify, strict TypeScript | Modular monolith, config validation, Pino request logging |
| PostgreSQL / Prisma 7 | User, Organization, OrganizationMember, Agent; two preserved migrations |
| Register / login | Zod validation, Argon2id, normalized email, JWT (15 minutes) |
| JWT guard | Signature, expiry, issuer/audience and required claim validation |
| Auth rate limiting | In-memory, per guarded route/IP; not shared across instances |
| Organizations | Atomic owner creation, membership-scoped read |
| Agent creation | OWNER required, tenant isolation, unique name per organization |
| Health | Liveness and database readiness |

| Method | Path | Authentication |
| --- | --- | --- |
| POST | /auth/register | Public, rate limited |
| POST | /auth/login | Public, rate limited |
| POST | /organizations | User JWT |
| GET | /organizations/:id | User JWT + membership |
| POST | /agents | User JWT + organization OWNER |
| GET | /health | Public |
| GET | /health/ready | Public; SELECT 1, sanitized 503 on failure |

Agent read/list work discussed during development is **not present in this remote
baseline**. Preserve/reconcile local unpushed work before modifying those files.
SUSPENDED exists in the Agent enum, but no suspension endpoint or agent credential
validation exists yet. There is no ActionRequest runtime, tool registry, execution,
policy, approval, limits, audit store, MCP or Swagger implementation yet.

See [constitution](AGENTS.md), [architecture decision](docs/adr-0001-action-safety.md)
and [verification evidence](docs/verification.md). This is not production-ready.

## Local setup (Windows CMD)
Use Node >=24.15.0 <25 (package engines) and Docker Compose v2.
Do not silently loosen engines to match a local Node installation.

```bat
copy .env.example .env
npm ci
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```
Put the generated value in JWT_ACCESS_SECRET in .env; keep .env private.
The committed example intentionally has no JWT secret. Never reuse a test secret.

```bat
npm run prisma:generate
docker compose up -d postgres
npx prisma migrate deploy
npm run build
npm start
```
Confirm Prisma prints database `agentgate`, not `agentgate_test`. A shell-level
DATABASE_URL overrides .env; `set "DATABASE_URL="` clears it in CMD.
Use `migrate dev --name ...` only when creating a new development migration;
use `migrate deploy` to apply existing migrations. Do not reset existing data blindly.

For the containerized API, apply migrations first from the host, then:
`docker compose --profile app up --build -d`. The runtime image does not run migrations.
Compose forwards JWT_ACCESS_SECRET to the API. Docker image execution has not been
verified in the current review environment. Database credentials are local examples;
keep the URL synchronized and encode special characters if you change credentials.
Existing volumes retain their original database credentials.

## Tests
```bat
npm run prisma:validate
npm test
npm run lint
```
`npm test` builds and runs `test/*.test.cjs` (12 tests in this baseline). Health
queries are mocked in that suite; a pass does not prove a live database connection.
These tests generate their own JWT secrets.

Integration tests use a separate database and existing migrations:
```bat
docker compose exec postgres createdb -U agentgate agentgate_test
```
Create the test database once. In a separate CMD window:
```bat
set "DATABASE_URL=postgresql://agentgate:local-development-only@localhost:5432/agentgate_test"
set "TEST_DATABASE_URL=%DATABASE_URL%"
npx prisma migrate deploy
npm run build
node --test test/*.integration.cjs
```
There are 7 integration files / 10 test cases in the reviewed baseline. They cover
registration races/hashing, login, organization membership/isolation, agent creation,
and HTTP authorization/rate limits. They create and remove their own fixtures.
Never point them at production. Close that CMD window when returning to development.

## Roadmap
A: finish identity (credential issuance, agent auth, suspension).
B: normalized actions, registry, executions/attempts, fake commerce HTTP provider.
C: business-aware policies. D: approvals bound to exact immutable actions.
E: deepen idempotency, duplicate protection, safe retry and unknown outcomes.
F: daily refund budget, then velocity. G: observe/simulation. H: MCP adapter.
Baseline idempotency is required in B; E does not postpone that safety requirement.

## Known limits
- Registration conflict responses permit account-existence inference.
- User JWTs have no revocation mechanism; membership is checked in the database.
- Agent creation uses Serializable; conflicting transactions return 409, not an
  automatic retry or a guarantee that revocation wins every overlap.
- Default startup error output is generic; centralized application error logging,
  secret-safe diagnostics, OpenAPI and dependency-advisory review remain work items.
- No external side effects or exactly-once claims exist in the current implementation.
