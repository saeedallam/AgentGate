# AgentGate project constitution

The user's founding requirements govern this project. Discuss conflicting requests
before changing architecture. Work incrementally: explain the goal and decisions,
name files, implement a small complete slice, run checks, fix problems, report
what actually works and propose the next slice. Do not implement the entire roadmap
at once. Inspect existing code first. The developer is learning NestJS/TypeScript;
make decisions visible and avoid unnecessary abstractions.

## Architecture and stack
- Modular monolith; thin controllers and business logic in services/domain layers.
- Node.js, strict TypeScript, NestJS, Fastify, PostgreSQL, Prisma, Redis, BullMQ,
  Zod, JWT, Argon2, Swagger/OpenAPI, Pino, Docker and Compose.
- Add Redis/BullMQ when asynchronous work is needed; policy evaluation stays synchronous.
- No unnecessary repository pattern over Prisma; avoid any; use DI and validation.
- Modules: auth, users, organizations, members, agents, agent-credentials, tools,
  connections, gateway, executions, policies, policy-engine, approvals, audit,
  common, infrastructure, app.module.ts. Create modules when implemented.
- Defer MCP, OpenTelemetry, ClickHouse, Kafka, Cedar/OPA, Kubernetes until needed.
- No microservices, ML/risk classifier, policy language, workflow builder, SSO,
  billing, mobile app or integration sprawl without an explicit discussed change.

## Security invariants
- Business-sensitive entities must carry organizationId. Tenant scope must come
  from authenticated identity/verified membership; never trust a request alone.
  Every tenant query and relationship must enforce isolation; test cross-tenant access.
- User is a global identity; OrganizationMember links it to organizations.
- Agent API keys use agt_live_..., shown once; store keyPrefix and keyHash only.
- Never log passwords, keys, tokens, connection secrets or unrestricted tool arguments.
- Authentication, authorization, rate limiting, replay, audit, race conditions,
  and idempotency are first-class concerns. Address SSRF before external connections.

## Runtime contract
- Authenticate agent -> resolve tool -> validate input -> policy -> decision ->
  execute only when authorized -> store result -> audit.
- Policy engine only decides: DENY > REQUIRE_APPROVAL > ALLOW; default DENY.
- Initial operators: EQ, NEQ, GT, GTE, LT, LTE, IN, NOT_IN, EXISTS.
- Input: organizationId, agent principal, tool action, arguments, environment/time context.
- Centralize execution transitions: RECEIVED, EVALUATING_POLICY, DENIED,
  AWAITING_APPROVAL, APPROVED, REJECTED, EXECUTING, SUCCEEDED, FAILED, CANCELLED.
- Approval: AWAITING_APPROVAL -> APPROVED -> EXECUTING or -> REJECTED.
  Require authorized membership; concurrent decisions must not trigger execution twice.
- Idempotency must cover duplicate requests, timeouts, retries, approvals and jobs.
  Never claim exactly-once external effects without provider support/reconciliation.
- Start with internal HTTP fake commerce provider: orders.get, customers.get,
  customers.update, refund.create, customers.delete. Exercise success, failures,
  timeout, 500, invalid input, duplicates, approval, deny and retry.
- Add real MCP tools/list and tools/call only after core modules stabilize.
- Audit important agent/credential/policy changes, requests, decisions, approvals,
  execution start and outcomes, with investigation-friendly metadata and redaction.

## Entities and milestones
- Core: User, Organization, OrganizationMember, Agent, AgentCredential, Tool,
  Connection, Policy, PolicyCondition, Execution, ApprovalRequest, ApprovalDecision,
  AuditEvent. Later: UsageRecord, Subscription, Secret, Alert.
- Milestone 1: Nest/Fastify, Postgres/Prisma, Docker Compose, config, health,
  User/Organization/OrganizationMember, register/login, Agent/AgentCredential,
  hashed API key creation, agent authentication guard, basic tests.
- Then Tools -> Executions -> Policy Engine, with Approvals and Audit.
- API families: /auth/register, /auth/login, /organizations, /agents and credentials/
  suspend, /tools, /policies, /v1/tool-calls, /executions, /approvals with approve/
  reject, /audit-events. Add individual operations only when needed.
- Tests: allow, deny, default deny, approval/approve/reject, suspended agent,
  invalid key/input, cross-tenant access, duplicates, double approval, timeout/failure.

## Current progress
Milestone 1 step 1: infrastructure foundation only. No user authentication or
business models yet. See README for verification and next work.
