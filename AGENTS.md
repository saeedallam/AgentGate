# AgentGate project constitution

## Product and scope

AgentGate is a **Runtime Action Safety Layer for AI Agents**, a general product for actions with real-world side effects across domains.

North star: the agent proposes an action; our system decides whether that exact action is allowed, under what conditions, and ensures execution is safe and auditable.

The user's latest direction supersedes the earlier customer-support niche: Fake Commerce is the first SaaS test environment, not the product's market boundary. Refund/account actions are concrete test scenarios. Keep commerce fields in action definitions/providers, not mandatory fields in generic execution or policy models.

MCP is deferred transport/integration, not the product. The core must work without it. Protection covers actions routed through AgentGate, not direct provider calls that bypass it.

## Working method

- This is an existing repository. Preserve working code, migrations and identity foundations. Do not scaffold a replacement.
- Before implementation, inspect AGENTS.md, README.md, package.json, Prisma schema/migrations, relevant src/ and test/ files. Run applicable build/tests/lint where possible and report limitations honestly.
- Work in small complete slices. Explain the problem, naive approach, its limitations, then the chosen design and implementation. Name patterns only when they genuinely apply.
- The developer is learning architecture and TypeScript/NestJS. Before code, show a Mermaid architecture/data-flow diagram, explain the naive approach and why this design was chosen, then explain meaningful syntax and what each test proves. Use small teaching sections in Arabic when conversing with the developer.
- Keep implemented behavior separate from plans. Update documentation as progress changes.
- Preserve unrelated working-tree changes. Do not stage unrelated files.
- Postman is a supplementary manual test client, not a replacement for automated tests.
- Do not implement the whole roadmap at once or add empty future modules.

## Architecture

- Modular monolith: Node.js, strict TypeScript, NestJS/Fastify, PostgreSQL/Prisma, Zod, JWT, Argon2 and Pino.
- Thin transport controllers -> application orchestration -> domain decisions -> infrastructure/adapters.
- Do not force full Clean Architecture, generic repositories over Prisma or interfaces everywhere. Isolate volatile infrastructure where needed.
- Keep action contracts, policy logic and execution transitions independent of HTTP/MCP.
- Future modules may include actions/tools, executions, policies/policy-engine, approvals, audit, limits and adapters. Create them only with their implementation.
- Redis/BullMQ only when asynchronous work requires them.
- No microservices, Kafka, Kubernetes, ClickHouse, AI/LLM risk classifier, custom policy language, OPA/Cedar, workflow builder, enterprise SSO, billing, complex dashboard or connector sprawl in the current scope.

## Security boundaries

- The LLM/agent is not a trusted security boundary. Treat arguments and client context as untrusted.
- Derive agent identity and organization from validated credentials. Derive user access from authentication and verified membership.
- Never trust client assertions of organization, permissions, approvals, resource ownership or action safety.
- Tenant-sensitive records and queries must enforce organization scope, including relationships and resource lookups. Test cross-tenant access.
- User is global; OrganizationMember links users to organizations.
- User administration routes use JWT. Agent action routes use AgentAuthGuard. Authentication alone does not authorize side effects.
- API keys use agt_live_..., return the secret at creation only and persist prefix plus secure hash. Never expose hashes or log secrets.
- Invalid, revoked or suspended credentials receive the same authentication rejection. Infrastructure failures must not become misleading 401 responses.
- A successful authentication check does not cancel in-flight work if the agent is suspended later. Execution-time controls must address this explicitly.
- Never log passwords, tokens, keys, provider secrets or unrestricted arguments. Audit evidence requires redaction and bounded retention.
- Address SSRF before external connections. Address rate limits, replay and concurrency with the corresponding slices.

## Normalized action contract

Define ActionRequest as a domain concept before deciding whether it needs a Prisma model. It represents:

- organizationId from trusted identity;
- principal with type agent and verified id;
- action name;
- optional resource type/id;
- validated action-specific arguments;
- context including environment and server-assigned request time.

HTTP, future SDKs and MCP normalize into this contract. Security-relevant environment/resource context must be verified server-side. Keep money/payment fields specific to relevant actions.

Conceptual runtime flow:
identify agent -> normalize/validate action -> inspect arguments/resource/context -> evaluate policies and relevant state -> detect duplicates/replay -> decision -> bind any approval to the exact action -> execute safely -> record outcome/update state -> audit evidence.

This is the target architecture, not a claim that every stage exists today.

## Policies

- Deterministic pure logic, unit-testable without NestJS/PostgreSQL; never execute actions inside the policy engine.
- Decisions: ALLOW, DENY, REQUIRE_APPROVAL. Default DENY. Precedence: DENY > REQUIRE_APPROVAL > ALLOW.
- Conditions may inspect agent, action, arguments, resource, environment and verified context.
- Initial operators may include EQ, NEQ, GT, GTE, LT, LTE, IN, NOT_IN and EXISTS. No custom programming language.
- User experience should eventually use business policy templates, not require a complicated DSL.
- Refund test scenario in USD: <= 50 ALLOW; > 50 and <= 500 REQUIRE_APPROVAL; > 500 DENY. Represent currency and monetary units explicitly when implemented.

## Execution and approval integrity

- Centralize state transitions; do not scatter arbitrary status assignments.
- Distinguish requested, authorized, awaiting approval, approved/rejected, started, effect confirmed, failed and cancelled.
- Consider OUTCOME_UNKNOWN before finalizing the model and explain its tradeoff: a timeout after sending a request does not prove the side effect failed.
- Record attempts and outcomes with enough safe evidence for later investigation, stateful limits and simulation.
- Every execution needs an idempotency strategy. Phase B uses fake effects only; Phase E develops and tests retry/concurrency guarantees before real integrations.
- Never claim external exactly-once effects without provider guarantees/reconciliation.
- Approvals bind one immutable exact action: organization, agent, action, resource and canonical arguments, plus relevant execution context.
- A changed amount/resource must not reuse approval. Concurrent/double approval must not trigger duplicate execution.
- Introduce canonical fingerprints deliberately; distinguish request idempotency from business duplicates such as refunding the same payment. Do not equate all identical payloads with forbidden repeat actions.
- Audit identity/credential changes, decisions, approvals, attempts and outcomes when those features are implemented.

## Fake Commerce test environment

Start with an internal fake provider, not Stripe or real payments. Begin with refund.create; extend to orders.get, customers.get, customers.update and customers.delete, then email.send as needed.

It is a test lab for a general SaaS safety product. Simulate success, validation errors, 500 responses, delays, timeouts, duplicate actions and unknown outcomes incrementally. Postman may stand in for an AI agent initially; a full SaaS UI or LLM integration is not a prerequisite.

## Ordered roadmap

### Phase A — Identity foundation
Verify existing code/tests and update documentation. Finish credentials, agent authentication, suspension enforcement and identity/tenant tests.

### Phase B — Action Core
Action registry, normalized ActionRequest, execution model, authenticated POST action requests, fake internal executor and persisted execution attempts/results. No advanced policies or real external side effects yet.
Implemented as the refund.create vertical slice; see the current progress and verification sections. Next implementation phase: C.

### Phase C — Business-aware policies
Policy/conditions and pure PolicyEngine on ActionRequest. Test argument-based ALLOW, REQUIRE_APPROVAL, DENY and default deny.

### Phase D — Approvals and integrity
Exact-action association, immutable approved payload, authorized decisions and concurrency/double-approval protection.

### Phase E — Safe execution
Idempotency keys, canonical fingerprints, business duplicate protection, safe retries, race tests and fake unknown-outcome scenarios.

### Phase F — Stateful business rules
Start with one daily refund budget. Later velocity, counters, duplicate resource actions and kill/freeze behavior. Do not build a generic stream-processing system.

### Phase G — Observe/simulation
Record would-deny/would-require-approval outcomes and simulate against suitable history. Do not implement now.

### Phase H — MCP adapter
Only after the core is stable. MCP tools/list and tools/call remain adapter concerns.

## Current progress and verification boundaries

Phase B now includes the registry, normalized request factory, execution state machine,
persisted execution/one dispatch attempt, tenant-owned FakePayment lab, POST /v1/actions
and GET /v1/executions/:id. The lab is off by default and prohibited in production.
A per-agent idempotency key prevents redispatch; changed payload returns 409.
Unknown or unfinished attempts are never automatically retried. The fake provider
supports success/rejection/delay/ambiguous errors and a lost response after effect.
Only refund.create is currently registered. This is the first complete vertical slice;
additional fake actions can follow without blocking Phase C.

Identity, user JWT, organizations/membership, agents and credential issuance/authentication
remain in place. Suspension/revocation administration endpoints are still deferred.
Policies, approvals, general retry/reconciliation, stateful budgets, simulation and MCP
remain future work. See docs/phase-b-guide.md and docs/verification.md for limits.

npm test builds and runs test/*.test.cjs; database *.integration.cjs files require separate execution and a dedicated agentgate_test database with migrations applied. Do not infer integration success from npm test.

The developer reported 22 passing ordinary tests and lint success on 2026-10-01, plus earlier credential/authentication integration success. These reports are not a fresh independent verification of every repository test.

Security test priorities as features arrive: tenant isolation; invalid/revoked/suspended credentials; validated input; default deny and argument decisions; approval mutation/double approval; duplicate requests/refunds; concurrent execution; timeout/retry and unknown outcomes; budget thresholds; observation behavior.

