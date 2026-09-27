# ADR 0001: Evolve into runtime action safety
Status: accepted product direction; future storage details are proposals.
Date: 2026-09-27. Baseline: 7d094ff8cc9cbeaa42c7aa36b017541154daf8ad.

## Problem and simplest inadequate solution
A tool ACL answers whether an agent can call refund.create. It does not answer
whether this refund is acceptable for this payment/amount, whether it already
happened, or whether a timeout concealed a successful refund. Renaming the gateway
would not solve these problems. We preserve identity and add action semantics.

## Architectural map
Transport (HTTP, later MCP/SDK) -> application orchestration -> domain decisions
and transitions -> infrastructure/provider adapters. User management uses JWT;
agent runtime calls will use agent credentials. Never conflate these principals.
Policy evaluation remains pure; orchestration obtains authoritative facts and
coordinates persistence/execution. Introduce Adapter/Strategy only when isolating
volatile execution infrastructure, and a state machine when execution is built.
No general-purpose repositories or full Clean Architecture scaffolding.

## Normalized ActionRequest concept (not a Prisma model yet)
```ts
interface ActionRequest {
  readonly organizationId: string;
  readonly principal: { readonly type: 'agent'; readonly id: string };
  readonly action: { readonly name: string };
  readonly resource?: { readonly type?: string; readonly id?: string };
  readonly arguments: Readonly<Record<string, unknown>>;
  readonly context: {
    readonly environment: 'development' | 'staging' | 'production';
    readonly requestedAt: Date;
  };
}
```
This is a design contract, not runtime validation or deep immutability. Transport
normalization must reject unsupported JSON values, validate action schemas and
construct server-owned identity/context. Resolve claimed resources against tenant
ownership; environment comes from server-managed credentials/connections, time from
the server. Agent metadata is separate untrusted input. Versions and an immutable
persisted snapshot are required before approval/fingerprinting.

## Refund reference case
Assume USD and integer minor units: <=5000 ALLOW, 5001..50000 REQUIRE_APPROVAL,
>50000 DENY. No matching policy means DENY. Different currencies need explicit
budgets/rules; do not aggregate mixed currencies or introduce implicit FX.
For the first fake vertical, an already-refunded payment is a business duplicate.
Partial/multiple legitimate refunds require an explicit later rule change.

## Execution and evidence
Separate Execution (one requested action) from ExecutionAttempt (one dispatch).
Before schema implementation review tenant keys, immutable normalized payload and
version, idempotency key, eventual fingerprint/version, resource ID, money/currency,
policy versions/reasons, approval binding, provider idempotency key/request reference,
attempt times and effect evidence. Store sensitive input only under defined
redaction/access/retention rules; audit should not blindly copy raw payloads.
Historical simulation needs the actual policy inputs and state evidence available
then, not current account state. Redacted/missing inputs must yield uncertainty.

Proposed lifecycle retains RECEIVED, EVALUATING_POLICY, DENIED, AWAITING_APPROVAL,
APPROVED, REJECTED, EXECUTING, SUCCEEDED, FAILED, CANCELLED. The states do not exist
in the current schema. ALLOW is authorization evidence; it is not a confirmed effect.

OUTCOME_UNKNOWN is recommended for a dispatch whose external effect cannot be
confirmed. The cost is a reconciliation path, operational visibility, reservations
held conservatively, and more transitions/tests. Without it, FAILED invites unsafe
retries. Do not add the enum now. Before execution implementation, decide transitions
such as EXECUTING -> OUTCOME_UNKNOWN -> reconciled SUCCEEDED or confirmed FAILED.
Cancellation is not a way to erase an unknown or confirmed effect. Generic HTTP 500
can also follow a side effect; provider semantics determine certainty.

## Three different integrity identifiers
1. Client idempotency key: tenant/principal scoped; same key + same normalized
   payload returns the same logical execution, changed payload conflicts.
2. Exact action fingerprint: versioned canonical identity/action/resource/arguments
   and any other authorization-relevant immutable fields. Approvals bind to this
   snapshot, never caller-supplied approval assertions. Resolve JSON order, numbers,
   defaults, currency and schema version before implementing a hash.
3. Business duplicate key: e.g. tenant + provider connection + payment. Different
   amounts may produce different fingerprints but still target the same payment.
A fingerprint alone does not prevent concurrent effects, and identical reads may
be legitimate. Persist claims/reservations atomically. Provider-supported idempotency
and reconciliation govern retry after ambiguous outcomes; no universal exactly once.

## Limits, approvals and rollout
Exact approval cannot be reused after argument/resource mutation. Decide approver
membership, policy changes, expiry, suspension and budget rechecks before dispatch.
Stateful limits later require atomic reservations; summing past success rows and
then sending a refund is race-prone. Start with a single daily budget using a defined
timezone/window/currency and conservative handling of unknown outcomes.
Observe mode records would-have decisions independently from enforcement. Simulating
on history does not reconstruct facts that were never captured.
Phase B is fake-only behind an explicit server-owned allow boundary. Keep default
DENY for real/unknown actions and implement baseline idempotency at first dispatch.

## Exact next feature after preparation
AgentCredential issuance only, before the agent guard:
- OWNER-only POST /agents/:id/credentials scoped to a verified organization.
- CSPRNG secret, proposed agt_live_<random-selector>_<secret> format; keyPrefix
  is a non-secret unique lookup selector, not merely the shared agt_live_ marker.
- Store organizationId, agentId, keyPrefix, Argon2id keyHash, creation/revocation
  metadata. Enforce the agent/organization pair with a composite database relation.
- Return raw key once with Cache-Control: no-store; never persist/log/retrieve it.
- Tests: ownership/tenant rejection, hash verification, response fields and absence
  of raw key in storage. No tool dispatch or public test-only auth endpoint.
Next slice: agent authentication derives tenant and agent from credential relation,
checks revocation/current status; suspension blocks subsequent requests and delayed
execution eligibility. Define in-flight limitations explicitly.
These are proposed implementation choices to explain before adding a migration.

## Preserve pending local work
Remote has agent creation only. The user's subsequent get/list/pagination work may
be local. Reconcile it in a separate review; this change does not overwrite agents
or migrations. No credential/execution tables or future module stubs are created here.
