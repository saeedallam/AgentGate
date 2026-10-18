# Operational hardening

This release closes the nine review items for the current fake-action vertical slice.
It is not certification of production readiness or a real-provider exactly-once guarantee.

## Upgrade

Run `npx prisma migrate deploy`, `npm run prisma:generate`, `npm test`, and
`npm run lint`. Apply migrations to the dedicated `agentgate_test` database before
running integration tests. There is one new migration. Do not change old migrations.

**Behavior changes:** unstarted requests expire after 24 hours; authenticated writes
are rate limited; MCP creation requires a host-owned operation UUID. Budget changes
no longer stop all admissions to an existing daily bucket.

## Policy evidence and code boundaries

New initial policy snapshots use `policyHashVersion: 2` and the same recursive
canonical JSON encoder as request fingerprints. Object keys are sorted, array
order is preserved, values and scope remain bound. Existing version-1 hashes are
unchanged; request hashes retain their original algorithm/version. Simulation
hashes also record version 2. No historical grant is recomputed or upgraded.

The shared `ActionRegistryModule` supplies a singleton registry to actions and
observations. Definitions hold no request-specific mutable state. Directly
constructed unit-test services get one registry at construction, never per request.

`ExecutionsService` is a facade over `ExecutionReceipts` (receipt/idempotency/approval
creation), `ExecutionClaims` (authorized first/retry claim + budget reservation), and
`ExecutionOutcomes` (finish, lease expiration, reconciliation + settlement).
Transactions remain whole inside these components. The policy evaluator, approval
binding gate and request preconditions are separate from action orchestration.

## Suspension and revocation

JWT OWNER only, stored membership checked and locked:

- `POST /v1/organizations/:organizationId/agents/:agentId/status`
  with `{"status":"SUSPENDED"}` or `{"status":"ACTIVE"}`.
- `POST /v1/organizations/:organizationId/agents/:agentId/credentials/:credentialId/revoke`
  with `{}`. Repeated revocation returns the original revocation time. There is no
  un-revoke operation; issue a new key if access is intentionally restored.

Foreign tenants and non-owners receive 404. No client role is accepted. Controls
and their audit events commit atomically. Claims hold a shared agent row lock;
controls require an exclusive lock on that same row. Suspension committed before a
claim prevents dispatch; a claim that already won is in flight and cannot be
retroactively cancelled. Completion and OWNER reconciliation remain available so
confirmed effects and budget settlements are not lost. Retry requires an active
agent and a currently valid credential. Reactivating an agent does not un-revoke keys.

## Shared rate limits

After agent authentication, action submission, resume, retry and reconciliation
share a fixed UTC-minute bucket: 60 requests per agent and 300 per organization.
Observation has a separate pair with the same limits. Reads are not charged to
these buckets. Counters are atomic PostgreSQL UPSERTs shared across API replicas;
rotating an API key does not reset an agent's count. Denied, invalid and duplicate
requests consume admission capacity. Organization admission happens first, so an
agent-limit rejection can consume an organization slot. No unbounded input-derived
bucket keys are used. A boundary burst up to two windows is possible with fixed
windows; this is not a sliding-window algorithm or a network-level DDoS defense.

429 includes `Retry-After: 60` and `ACTION_RATE_LIMITED`. Preserve the existing
operation identity when retrying. A database failure fails the request; it never
silently disables throttling. Auth endpoints retain their existing auth throttler.

## Expiration without falsifying history

`Execution.expiresAt` is an immutable receipt deadline, initially creation + 24h.
Approval deadlines are bound by a database trigger to the execution deadline.
Existing rows receive **their original createdAt + 24h**, not a renewed 24h grant.
Check migration impact on old pending demos before upgrading.

An expired RECEIVED request cannot start. An expired PENDING approval cannot be
approved or rejected. Application predicates and database triggers enforce this,
including a clock boundary between checking and writing. The API returns the
immutable `expiresAt`, and approval summaries return `expired`. The console hides
expired decision controls. **Recorded lifecycle/decision status is preserved**:
PENDING plus `expired: true` means no decision was recorded before expiry; APPROVED
still records the historical human decision. We do not add a fabricated rejection
or mutate a human decision to EXPIRED. No scheduler is required to enforce validity.

The deadline governs **first dispatch**, not the lifetime of an external effect.
EXECUTING/OUTCOME_UNKNOWN work still uses leases, bounded durable retries and
reconciliation; its budget hold is never released because the receipt is old.
Replays cannot renew the deadline. A genuinely new intent requires a new explicit
request and authorization. Do not create new intents to recover unknown effects.

## Sensitive-read and control audit

Console OWNER reads of arguments/results and OWNER approval detail reads await a
`SecurityAuditEvent` insert before returning the sensitive response. Events contain
organization ID, actor user ID, target execution ID, event type and server time.
They do **not** duplicate arguments, results, tokens or keys. MEMBER summaries do
not create sensitive-read events. If audit persistence fails, sensitive data is not
returned. This records authorized disclosure preparation, not proof a person read
the screen. Existing query-level OWNER predicates remain, including approval detail.

Control events use agent or credential target IDs. Events reject UPDATE; retention
is intentionally allowed to DELETE records older than 90 days with the bounded
operator command `node scripts/prune-security-events.mjs` (1000 per run). Schedule
it externally. The same command removes old idle rate counters. Database superuser
access is outside application immutability guarantees. This is not a complete
platform-wide audit product; agent execution result reads remain part of execution
history and are not human-console sensitive-read events.

## Mid-day budget changes

Once a bucket exists, its recorded cap is authoritative for that UTC day. A config
change neither resets counters nor refuses all admissions: refunds may continue
within the **original cap**. At the next UTC day, a newly opened bucket uses the
configured cap. Monitoring returns `nextDayLimitMinor` and `nextDayStartsAt`; the
console shows this separately from today's recorded cap. All replicas must have the
same configuration before opening the next day's bucket. There is no DB-backed
policy/config scheduler yet. Removing configuration leaves an existing bucket
active for its day; null next-day cap means no configured enforcement tomorrow.
Use suspension for an immediate stop, not an attempted mid-day cap change.

## MCP host-owned operation identity (breaking tool-schema change)

`refund_create` accepts only paymentId, amountMinor and currency. The model cannot
supply `idempotencyKey`. The trusted host sets `AGENTGATE_OPERATION_ID` to a UUID and
stores it durably **before** launching the adapter. One adapter process represents
one creation intent. The adapter sends `mcp_<UUID>` as the backend operation key.
No configured UUID: creation returns `HOST_OPERATION_REQUIRED` without HTTP dispatch;
observation and existing-execution tools remain usable.

The host reuses the UUID across timeouts and process restarts. Changed payload under
that UUID conflicts with the backend's persisted request binding. A distinct,
explicitly requested new intent requires the host to launch with another persisted
UUID. The tool cannot rotate it. There is no automatic retry and no UUID generation
from the payload: two intentional actions may have identical arguments.

This does not infer user intent, authorize the host to generate fresh IDs for every
retry, or prevent a misbehaving host/direct HTTP client from submitting new intents.
Provider business-duplicate controls, policies, approvals and budgets still matter.

## Verification

Run `npm test`, `npm run lint`, and the native PostgreSQL CI integration suite.
New tests cover canonical hashes, expiry semantics, host MCP identity across adapter
reconstruction, database-enforced deadlines, sensitive-read audit failure, OWNER
controls/tenant isolation, and shared fixed-window admission under independent
connections. Existing claim/recovery/budget concurrency tests remain required.
