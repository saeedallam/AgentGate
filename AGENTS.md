# AgentGate project constitution

## Product direction (accepted 2026-09-27)
AgentGate is a **Runtime Action Safety Layer for AI Agents**, initially for
customer-support agents performing refunds and account actions.

> The Agent proposes an action. Our system decides whether that exact action is
> allowed, under what conditions, and ensures the side effect is executed safely
> and audibly.

"Audibly" in the north star means auditable evidence, not audio output.
MCP is a future adapter, not the product or a domain dependency. The core must be
useful without MCP. The founding requirements remain unless explicitly superseded
here. Discuss future conflicting changes before implementing them.

## Preserve the existing project
- Evolve the existing modular monolith. No new scaffold, deleted migrations or
  wholesale rewrites. Preserve working auth, tenant isolation, agents and tests.
- Inspect AGENTS.md, README, schema, source, tests, migrations and package.json
  before changes; establish build/test/lint baseline where available.
- GitHub may lag the developer's Windows working copy. Never overwrite or recreate
  unpushed work based solely on absence from the remote. Report that discrepancy.
- Node/strict TypeScript, NestJS/Fastify, PostgreSQL/Prisma, Zod, JWT, Argon2,
  Pino and Docker remain. Redis/BullMQ only when async execution needs them;
  policy evaluation stays synchronous. Swagger/OpenAPI remains unfinished work.
- Controllers are thin; services coordinate use cases. Pure domain logic owns
  decisions, transitions and eventual fingerprint rules. Infrastructure owns
  persistence, external calls and queues. No generic repository layer by default.
- Create modules only when implementing them. No empty future modules.

## Security and action semantics
- Treat the agent/LLM, arguments, resource identifiers and claimed context as
  untrusted. Derive organization, principal, environment and receipt time from
  authenticated credentials/server configuration; resolve resource ownership
  server-side. Agent-supplied context is not authoritative policy evidence.
- Every sensitive tenant entity/query must enforce organizationId. User is a
  global identity; OrganizationMember connects it to organizations.
- Agent keys: agt_live_..., show the full key once, persist prefix + secure hash
  only; no raw-key logs, recovery endpoint or accidental serialization.
- Enforce credential validity and current agent suspension at authentication;
  recheck execution eligibility before delayed work. No stale authorization cache
  by default. Revocation cannot undo an already-confirmed external effect.
- Normalize transports into ActionRequest before safety decisions. See the ADR.
- Policies inspect agent, action, arguments, resource, environment and verified
  context. DENY > REQUIRE_APPROVAL > ALLOW; default DENY. Initial operators:
  EQ, NEQ, GT, GTE, LT, LTE, IN, NOT_IN, EXISTS. No DSL, OPA or Cedar now.
- Policy engine is deterministic pure logic, independent of Nest/Prisma, and
  never executes actions. Future stateful checks consume authoritative snapshots;
  concurrent budget reservations must be coordinated with persistence.
- Separate requested, authorized, approved, started and confirmed effects.
  Transitions are centralized. The prior proposed states are not implemented.
  Consider OUTCOME_UNKNOWN for ambiguous remote effects; explain/approve its
  transition semantics before adding a database enum.
- A timeout or HTTP 500 is not proof that no side effect occurred. Unknown effects
  must not be blindly retried or reported as definite failure.
- Idempotency is required from the first executable action. Never claim exactly
  once for external effects without provider support. Queue deduplication alone
  is insufficient. Phase E refines baseline integrity, not its first introduction.
- Distinguish request idempotency, exact-action fingerprint and business duplicate
  rules (e.g. already-refunded payment). Same fingerprint is not universally a
  forbidden duplicate. Different amounts on one payment may still violate a rule.
- Approvals bind an immutable normalized action/version/fingerprint. Mutation
  requires a new decision/approval. Double decisions must not double-dispatch.
- Audit evidence must support investigations and future simulation: action and
  policy/schema versions, inputs to decisions, reasons, attempt/result references,
  authoritative timestamps and confirmed/unknown outcomes. Redact secrets; define
  retention and sensitive-payload protection before persisting historical inputs.
- Do not trust self-reported containsSensitiveData or resource ownership.
- Money uses integer minor units and explicit currency, not floating-point dollars.

## Flagship scenario and roadmap
Fake commerce first: refund.create, orders.get, customers.get, customers.update,
customers.delete; email.send later. Refund <= $50 ALLOW, > $50 and <= $500
REQUIRE_APPROVAL, > $500 DENY. Duplicate refund, daily budget and velocity rules
follow with authoritative state. A decision never independently guarantees an effect.

A. Finish identity: reconcile existing changes, correct docs/test setup, then
   AgentCredential issuance, agent auth guard, suspension and tenant tests.
B. Action core: registry, normalized ActionRequest, reviewed execution/attempt
   model, agent endpoint and internal fake HTTP executor. Record results and
   baseline idempotency. Fake-only execution uses an explicit server-owned allow
   boundary; absent policy infrastructure never grants unrestricted real actions.
C. Business policies: pure engine, argument/resource rules and default-deny tests.
D. Approvals: immutable exact-action binding, authorized decisions and concurrency.
E. Execution integrity: safe retries, canonical fingerprint, duplicate rules,
   reconciliation/unknown outcomes and race tests using the fake provider.
F. Stateful rules: start with one daily refund budget; then velocity/counters/freeze.
G. Observe/simulation: record hypothetical versus enforced decisions distinctly.
   Historical replay must disclose missing historical context and uncertainty.
H. MCP adapter: tools/list and tools/call translate to/from the same action core.

The fake provider is a test lab: support success, validation rejection, 500,
pre-effect timeout, post-effect timeout, delay, duplicates and unknown outcomes.
No real Stripe integration now.

## Explicitly deferred
Microservices, Kafka, Kubernetes, AI risk classification, LLM authorization,
custom policy language, workflow builder, enterprise SSO, billing, connector sprawl,
complex dashboards, ClickHouse, OPA/Cedar and premature distributed systems.
Business templates (support, DevOps, finance) are future UX, not a new DSL.

## Development and evidence
Before meaningful implementation: explain the problem, naive approach, why it
fails, smallest suitable design and alternatives; name patterns only when useful.
Then identify files, implement a coherent small slice, test, fix errors and report
actual behavior/limits. The developer is learning: do not substitute code dumps
for an architecture map. Explain tests briefly unless deeper instruction is asked.
Commit/push at complete feature boundaries or explain a necessary exception.
Do not send ZIPs as the default collaboration method. Prefer reviewable diffs/PRs
and code in conversation. Do not merge without authorization.

Tests must cover tenant boundaries, credential validity/suspension, argument-aware
policy decisions/default deny, approval mutation/double approval, retries/races,
duplicate refunds, unknown external outcome, budget boundaries and observation.
Never claim a database/integration check passed when it was blocked or not run.
See README for implemented endpoints and docs/verification.md for current evidence.
