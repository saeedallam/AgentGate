<div align="center">
  <img src="docs/assets/readme-hero.svg" alt="AgentGate — Let agents do the work. You set the boundaries." width="100%" />

  <h1>AgentGate</h1>
  <p><strong>Runtime action safety for AI agents.</strong><br />The agent proposes. Your policies decide. Execution leaves a trail.</p>

  <a href="https://github.com/saeedallam/AgentGate/actions/workflows/backend.yml"><img src="https://github.com/saeedallam/AgentGate/actions/workflows/backend.yml/badge.svg?branch=main" alt="Backend verification" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-edbd45" alt="License: MIT" /></a>
  <a href=".nvmrc"><img src="https://img.shields.io/badge/Node.js-24.19.0-28765a" alt="Node.js 24.19.0" /></a>
  <a href="docs/project-roadmap-status.md"><img src="https://img.shields.io/badge/status-Fake%20Commerce%20lab-21392d" alt="Status: Fake Commerce lab" /></a>

  <p>
    <a href="#quick-start">Quick start</a> ·
    <a href="#the-hive-console">Web console</a> ·
    <a href="#how-it-works">Architecture</a> ·
    <a href="#documentation">Documentation</a> ·
    <a href="SECURITY.md">Security</a>
  </p>
</div>

---

## Why AgentGate?

An agent can propose a valid action that should never execute. A refund may exceed a limit, belong to another organization, require a human decision, or have already happened despite a lost response.

**AgentGate puts an explicit control layer between the agent and the side effect.** It authenticates the agent, validates the action, records a policy decision, binds approvals to the exact request, and controls dispatch and recovery.

The core is independent of the model and transport. **Fake Commerce is the first test environment, not the product boundary.** The current working action is `refund.create`; more domains and real providers are future work.

> **Current scope:** a working, tested Fake Commerce vertical slice with an English web console and local MCP adapter. It is not a production-readiness claim. Protection applies only to actions routed through AgentGate.

## Built into the gate

| Capability | What it does |
| --- | --- |
| **Trusted identity** | JWT user sessions, organization membership and hashed agent credentials. Tenant identity comes from authentication, not the request body. |
| **Deterministic policies** | Default deny. Among matching rules: `DENY` → `REQUIRE_APPROVAL` → `ALLOW`. Initial decision evidence is persisted. |
| **Exact-action approvals** | Owners review the stored request. Approvals bind to its fingerprint; a decision alone never dispatches the action. |
| **Replay protection** | The same agent, idempotency key and payload return the existing execution. A changed payload conflicts. |
| **Explicit recovery** | Reconcile uncertain outcomes, preserve provider operation keys, and fence stale attempts. Fake-provider retries are bounded. |
| **Daily budgets** | Reserve capacity before dispatch. Confirmed success consumes it; definite failure releases it; unknown outcomes retain the hold. |
| **Observe and simulate** | Evaluate hypothetical decisions without executing actions or granting permission. |
| **HTTP, console and MCP** | Different entry points, with the existing backend authorization and execution controls retained. |

## The Hive console

A same-origin English dashboard with a honey-and-forest identity. It reads **your backend data**, not seeded browser-only demo records.

- **Overview & executions** — inspect recorded outcomes, policy evidence and attempts.
- **Agents & keys** — create agent identities and issue owner-authorized credentials.
- **Approvals** — review exact stored actions and approve or reject them.
- **Budgets & studies** — monitor capacity and explore non-executing policy simulations.
- **Action playground** — observe or submit a fake refund through the protected API.

After startup, open **[localhost:3000/console](http://localhost:3000/console)**. Sign in with an existing account or create one. JWTs and agent keys stay in page memory; reloading requires signing in again.

See the [console guide](docs/console-guide.md) for setup, permissions and first-action walkthroughs.

## How it works

```mermaid
flowchart TD
    Agent[Agent via HTTP or local MCP] --> Identity[Authenticate and validate]
    Identity --> Policy[Record policy decision]
    Policy -->|Deny| Stop[Stop before dispatch]
    Policy -->|Require approval| Review[Owner reviews the exact action]
    Policy -->|Allow| Gate[Check current permission and claim execution]
    Review -->|Approved and explicitly resumed| Gate
    Gate --> Budget[Reserve configured budget]
    Budget --> Provider[Fake Commerce provider]
    Provider --> Evidence[Record outcome and settle or retain reservation]
```

The diagram is conceptual: **execution admission and budget reservation are atomic**. Current policy, approval binding and agent eligibility still govern execution. Unknown outcomes stay uncertain until evidence resolves them; a missing response is not permission to repeat the effect.

The implementation is a **modular monolith**:

| Layer | Main code |
| --- | --- |
| HTTP orchestration and console | [`src/actions`](src/actions), [`src/console`](src/console) |
| Identity and tenant boundaries | [`src/auth`](src/auth), [`src/agent-credentials`](src/agent-credentials) |
| Policy and human decisions | [`src/policies`](src/policies), [`src/approvals`](src/approvals) |
| Execution, recovery and capacity | [`src/executions`](src/executions), [`src/budgets`](src/budgets) |
| Provider and optional transport | [`src/fake-commerce`](src/fake-commerce), [`src/providers`](src/providers), [`src/mcp`](src/mcp) |
| Observation and persistence | [`src/observations`](src/observations), [`prisma/schema.prisma`](prisma/schema.prisma) |

**Stack:** TypeScript · NestJS · Fastify · PostgreSQL · Prisma · Zod · JWT · Argon2.

## Quick start

### 1. Prepare the environment

Use **Node.js 24.19.0**, npm and Docker Compose v2. The pinned version is shared by `.nvmrc`, CI and Docker. Node 22 is outside the supported range.

```sh
git clone https://github.com/saeedallam/AgentGate.git
cd AgentGate
npm ci
```

Copy `.env.example` to `.env`:

| Terminal | Command |
| --- | --- |
| Windows CMD | `copy .env.example .env` |
| macOS / Linux | `cp .env.example .env` |

Generate a secret locally and put it in `JWT_ACCESS_SECRET` in your `.env`:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Do not commit or share that value. If the project is already configured, keep your existing `.env`.

### 2. Start the database and API

Start Docker Desktop first if you use it, then run:

```sh
docker compose up -d --wait postgres
npm run prisma:generate
npx prisma migrate deploy
npm run build
npm start
```

| URL | Purpose |
| --- | --- |
| [localhost:3000/console](http://localhost:3000/console) | Sign in to the web console |
| [localhost:3000/health](http://localhost:3000/health) | Check that the process is running |
| [localhost:3000/health/ready](http://localhost:3000/health/ready) | Check database connectivity |

**A running server does not imply a ready database.** If login fails and readiness returns `503`, check PostgreSQL and `DATABASE_URL` first. Existing database volumes retain their original credentials.

These instructions run the API locally. The optional Compose API profile needs `JWT_ACCESS_SECRET` wiring before use. See [Windows and dependency troubleshooting](docs/dependency-maintenance.md), including Argon2 build issues.

### 3. Try a protected action

The fake execution lab is **off by default** and prohibited in production. New requests are denied when `POLICY_RULES_JSON=[]`.

Use the [console getting-started guide](docs/console-guide.md) to create a workspace and agent, configure a development policy, and seed a tenant-owned fake payment. Keep keys outside the repository.

The sample USD refund policy uses integer **cents**:

| Amount | Sample policy decision |
| --- | --- |
| Up to $50 (`5000`) | `ALLOW` |
| Above $50 through $500 (`50000`) | `REQUIRE_APPROVAL` |
| Above $500 | `DENY` |

These are sample configured rules, not universal hardcoded product limits. Provider checks, duplicate protection and configured daily budgets also apply.

## Verification

```sh
npm run prisma:validate
npm test
npm run lint
npm run audit:dependencies
```

`npm test` builds and runs `test/*.test.cjs`. Database `*.integration.cjs` suites run separately.

<details>
<summary><strong>Run database integration tests locally</strong></summary>

Create a dedicated disposable database named `agentgate_test`. With the default local Compose credentials, run once:

```sh
docker compose exec postgres psql -U agentgate -d postgres -c "CREATE DATABASE agentgate_test;"
```

In a separate Windows CMD window:

```cmd
set "TEST_DATABASE_URL=postgresql://agentgate:local-development-only@localhost:5432/agentgate_test"
set "DATABASE_URL=%TEST_DATABASE_URL%"
npx prisma migrate deploy
npm run build
node --test --test-concurrency=1 test/actions-http.integration.cjs test/approval-concurrency.integration.cjs test/recovery-concurrency.integration.cjs test/refund-budget-concurrency.integration.cjs
```

This is a representative subset. See the [backend workflow](.github/workflows/backend.yml) for its complete suite and [verification notes](docs/verification.md) for evidence and limitations.

That CMD window now targets the **test database**. Use your normal development environment when starting the application. Never point these suites at production data. Postman complements automated tests; do not export populated credentials.

</details>

[GitHub Actions](https://github.com/saeedallam/AgentGate/actions/workflows/backend.yml) runs dependency auditing, ordinary tests, native PostgreSQL integrity/concurrency suites and Docker packaging. Check the current run rather than relying on a fixed test-count claim.

## Documentation

| Explore | Guide | Postman |
| --- | --- | --- |
| Console and first use | [Web console](docs/console-guide.md) | — |
| Action contract and execution | [Phase B](docs/phase-b-guide.md) · [Arabic architecture & syntax](docs/phase-b-arabic.md) | [Collection](docs/AgentGate-Phase-B.postman_collection.json) |
| Policy evaluation | [Phase C](docs/phase-c-guide.md) · [Persistence](docs/policy-persistence.md) · [Tightening](docs/policy-tightening.md) | [Collection](docs/AgentGate-Phase-C.postman_collection.json) |
| Human approvals | [Phase D](docs/phase-d-approvals.md) | [Collection](docs/AgentGate-Phase-D.postman_collection.json) |
| Safe recovery | [Phase E](docs/phase-e-safe-execution.md) | [Collection](docs/AgentGate-Phase-E.postman_collection.json) |
| Daily refund budgets | [Phase F](docs/phase-f-daily-refund-budget.md) | [Collection](docs/AgentGate-Phase-F.postman_collection.json) |
| Observation and simulation | [Phase G](docs/phase-g-observation-simulation.md) | [Collection](docs/AgentGate-Phase-G.postman_collection.json) |
| Local stdio adapter | [Phase H / MCP](docs/phase-h-mcp-adapter.md) | — |
| Scope and engineering | [Roadmap status](docs/project-roadmap-status.md) · [Verification](docs/verification.md) · [Project constitution](AGENTS.md) | — |

## Scope and next steps

The initial **A–H Fake Commerce slice is implemented**, including the connected console. AgentGate is designed to grow across action domains, but currently registers only `refund.create`.

Deliberate boundaries today:

- **No real payment provider** or guarantee of exactly-once external effects. Real integrations need their own idempotency and reconciliation contract.
- **Explicit recovery**, not an automatic retry worker. New supported executions have at most three numbered attempts; legacy records are not silently upgraded.
- **Server-configured policies and budgets**, not a policy-management UI. Serving nodes must use compatible snapshots.
- **Local stdio MCP**, not a public remote MCP service. MCP cannot approve requests or bypass the HTTP API.
- Shared action/observation rate limits, OWNER suspend/revoke endpoints, first-dispatch/approval deadlines and sensitive-read audit are implemented. Broader audit capabilities and production operations remain future work.

See the [roadmap status](docs/project-roadmap-status.md) for the full boundary between implemented features and plans.

## Security and license

Read [SECURITY.md](SECURITY.md) for reporting guidance. Never publish passwords, JWTs, agent keys or unrestricted request data in issues or screenshots.

AgentGate is licensed under **[MIT](LICENSE)**. Copyright © 2026 Saeed Allam. Dependencies retain their own licenses; bundled DM Sans and Manrope fonts include their SIL Open Font Licenses. `private: true` prevents accidental npm publication and does not change the source license.

---

<p align="center">
  <img src="public/console/logo.svg" width="28" alt="AgentGate" /><br />
  <strong>A little freedom. A lot of control.</strong>
</p>

## Operational controls

See [Operational hardening](docs/operational-hardening.md) for suspension/revocation,
shared action limits, 24-hour first-dispatch deadlines, sensitive-read audit,
next-day budget changes and the host-owned MCP operation UUID upgrade.

## Interactive API reference

Open **[Swagger UI](http://127.0.0.1:3000/docs)** while running in development.
The **[OpenAPI JSON](http://127.0.0.1:3000/openapi.json)** can be imported into Postman.
User JWT and agent API key authorization are documented separately; existing guards
and policy checks still apply. Set `API_DOCS_ENABLED=false` to disable documentation;
it is disabled by default in production. See [the Swagger guide](docs/openapi.md).
