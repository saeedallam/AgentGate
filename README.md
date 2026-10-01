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

The agent HTTP guard test uses a test-only controller. There is no product action-request endpoint yet. Suspension/revocation are enforced when stored state changes; administrative endpoints for those changes are not implemented.

Action registry, normalized ActionRequest, execution records, Fake Commerce, policies, approvals, budgets, simulation and MCP are planned, not implemented.

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

Postman will exercise the existing management routes and, once implemented, the agent action endpoint. It complements automated tests; the test-only guard controller is not available in the running application.

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

The next implementation slice is a normalized ActionRequest and an action registry with validated `refund.create` input. Then introduce the execution lifecycle and fake provider incrementally. Phase B is a fake-only test flow, not authorization to execute real side effects before the safety controls exist.

The later refund policy scenario uses USD examples: up to $50 ALLOW; above $50 through $500 REQUIRE_APPROVAL; above $500 DENY. Duplicate refunds, budgets and velocity arrive in their respective phases.

## Development approach

Preserve the existing modular monolith and migrations. Explain each component's problem and design before implementing a small tested slice. Add modules and abstractions only when needed. See [AGENTS.md](AGENTS.md) for the project constitution and security rules.
