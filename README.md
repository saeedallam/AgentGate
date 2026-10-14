# AgentGate

Runtime Action Safety Layer for AI Agents.

**The agent proposes an action. AgentGate decides whether that exact action is allowed, under what conditions, and controls its execution with auditable evidence.**

AgentGate is a general product for actions with real-world side effects: payments, refunds, messages, data changes, deployments and infrastructure operations. Its core is independent of the agent's model and transport protocol. Protection applies to actions routed through AgentGate; it cannot control direct execution that bypasses it.

## Product direction

Fake Commerce is our first SaaS test environment, with a support agent requesting `refund.create`. It is a concrete implementation and testing scenario, not a restriction of the product to customer support or commerce.

Keep action requests, policy decisions, execution lifecycle and approvals general. Commerce-specific fields and validation belong to action definitions and providers.

MCP is a future adapter. The core must remain useful without MCP.

## Current implementation

The identity foundation includes:

- NestJS/Fastify, configuration validation, health/readiness and PostgreSQL/Prisma.
- User, Organization, OrganizationMember, Agent and AgentCredential models and migrations.
- Registration with Argon2 password hashing, login and JWT authentication.
- Organization membership checks and tenant-scoped agent creation, listing and reading.
- Owner-authorized credential issuance via `POST /agents/:id/credentials`.
- `agt_live_...` keys returned on creation only; only prefix and hash are stored.
- Agent authentication rejects invalid keys, revoked credentials and suspended agents.
- AgentAuthGuard extracts a Bearer key and assigns database-derived agent identity.
- Unit, HTTP and database integration test files.

Phase B now provides a complete fake-only refund flow:

- Action registry and normalized ActionRequest factory.
- Persisted execution lifecycle; Phase E adds bounded numbered recovery attempts.
- Tenant-owned Fake Commerce payment fixtures and simulated refunds.
- POST /v1/actions and GET /v1/executions/:id with agent authentication.
- Per-agent Idempotency-Key matching, atomic claim, duplicate fake refund protection,
  stable outcomes and no automatic replay of ambiguous/unfinished effects.

Phase C adds validated, tenant-scoped server policies and a pure PolicyEngine.
DENY overrides REQUIRE_APPROVAL, which overrides ALLOW; no matching grant denies.
Initial decisions, reasons, evaluation times and rule fingerprints are persisted.
Same-key replay cannot upgrade a saved DENY or REQUIRE_APPROVAL; legacy pending
records without decisions require review. See [decision persistence](docs/policy-persistence.md).
The policy gate runs before claim/provider dispatch. Configure POLICY_RULES_JSON;
with its default [] new receipts are denied. See [Phase C setup and Postman guide](docs/phase-c-guide.md).

The lab is disabled by default and cannot execute in production. Approvals and explicit
fake-provider recovery are implemented; budgets, simulation and MCP remain planned.
Administrative suspension/revocation endpoints are not yet implemented.

اقرأ [الشرح المعماري بالعربي وشرح الـsyntax](docs/phase-b-arabic.md).

See [Phase B architecture, syntax and Postman guide](docs/phase-b-guide.md).
Import [the Postman collection](docs/AgentGate-Phase-B.postman_collection.json)
and set its local variables. Never export populated secrets.

## Local setup

Requires Node.js 24.15+ (below 25), npm and Docker Compose v2.

Copy `.env.example` to `.env` (Windows CMD: `copy .env.example .env`; POSIX: `cp .env.example .env`). Set a private `JWT_ACCESS_SECRET`; generate one locally with:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Paste the value into your local `.env`. Do not commit or share it.

```sh
npm ci
npm run prisma:generate
docker compose up -d --wait postgres
npx prisma migrate deploy
npm run build
npm start
```

- `GET http://localhost:3000/health`: process liveness.
- `GET http://localhost:3000/health/ready`: database readiness, with sanitized failure responses.

Compose database credentials are for local development. Keep DATABASE_URL consistent with your configuration; existing volumes retain their original credentials. The optional Compose API profile still needs JWT_ACCESS_SECRET wiring before it is a complete startup path; the instructions above run the API locally.

## Verification

```sh
npm run prisma:validate
npm test
npm run lint
```

`npm test` builds and runs `test/*.test.cjs`. It does not run `*.integration.cjs`.

For database integration tests, create a dedicated disposable database named `agentgate_test`, apply the existing migrations to that database, and set TEST_DATABASE_URL to its connection URL. Never use a production database. For example, with the default local Compose credentials, create the database once:

```sh
docker compose exec postgres psql -U agentgate -d postgres -c "CREATE DATABASE agentgate_test;"
```

In a separate Windows CMD window:

```cmd
set "TEST_DATABASE_URL=postgresql://agentgate:local-development-only@localhost:5432/agentgate_test"
set "DATABASE_URL=%TEST_DATABASE_URL%"
npx prisma migrate deploy
npm run build
node --test test/agent-credentials.integration.cjs test/agent-credentials-http.integration.cjs test/agent-authentication.integration.cjs
```

The DATABASE_URL override in that window targets the test database. Use your normal development environment when starting the application. Other integration tests are available under `test/`.

Postman can exercise the management routes and the implemented /v1/actions endpoint. It complements automated tests.

## Roadmap

| Phase | Scope |
| --- | --- |
| A — Identity foundation | Verify identity, credentials, suspension enforcement and tenant isolation; keep documentation current. |
| B — Action Core | Action registry, normalized ActionRequest, execution model, authenticated POST route, fake executor and persisted attempts/results. |
| C — Business-aware policies | Pure deterministic policy logic, argument/resource conditions, default DENY and ALLOW / DENY / REQUIRE_APPROVAL. |
| D — Approval integrity | Exact-action approvals, immutable approved payload and concurrency/double-approval protection. |
| E — Safe execution | Idempotency, canonical fingerprints, duplicate detection, safe retries and unknown outcomes. |
| F — Stateful rules | Start with one daily refund budget rule; later add velocity and other limits. |
| G — Observe/simulation | Record hypothetical decisions and replay policies against suitable execution history. |
| H — MCP adapter | Normalize MCP into the stable Action Core. |

Phase C policy evaluation and dispatch gating are implemented. Phase D adds approvals and exact-action integrity (see below).
Phase B remains a fake-only lab and does not authorize real side effects.

The later refund policy scenario uses USD examples: up to $50 ALLOW; above $50 through $500 REQUIRE_APPROVAL; above $500 DENY. Duplicate refunds, budgets and velocity arrive in their respective phases.

## Development approach

Preserve the existing modular monolith and migrations. Explain each component's problem and design before implementing a small tested slice. Add modules and abstractions only when needed. See [AGENTS.md](AGENTS.md) for the project constitution and security rules.



## Phase D — Approval workflow

Phase D adds one approval per exact stored request, OWNER decisions using JWT,
summary-only MEMBER monitoring, database immutability checks, and explicit
agent-authenticated `POST /v1/executions/:id/resume`. A human decision alone never
calls the provider. Current DENY still blocks an approved action; started attempts
are never automatically retried, including OUTCOME_UNKNOWN.

See [approval architecture, limits and Windows verification](docs/phase-d-approvals.md)
and import [the Phase D Postman collection](docs/AgentGate-Phase-D.postman_collection.json).
The backend workflow runs ordinary tests and the Phase C/D database suites against
PostgreSQL 17. A workflow's existence does not mean its current run passed; inspect
GitHub Actions or run the native concurrency test locally.

### Policy tightening

Saved ALLOW receipts that have not started become terminal DENIED when current rules
require approval or deny. Same-key replay cannot revive them after relaxation.
See [contract, concurrency boundary and migration steps](docs/policy-tightening.md).

## Phase E — Safe recovery

Explicit `/v1/executions/:id/reconcile` and `/retry` preserve the operation key,
use durable fake-provider receipts and fence stale attempt completions. New
executions have at most three attempts; old executions are not silently upgraded.
OWNER-only reconciliation remains available when an agent is suspended. No
background retry worker or real provider is introduced.
See [contract, architecture, Windows steps and limits](docs/phase-e-safe-execution.md)
and [Postman collection](docs/AgentGate-Phase-E.postman_collection.json).
