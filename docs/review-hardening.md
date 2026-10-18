# Review hardening — dependency and authority boundaries

This slice addresses the configuration and identity hazards found during the
console review, plus the first frontend maintainability changes. It does not
complete every item in the production backlog.

## Changes

- `ExecutionsService` requires `ConfigService`. Missing dependency injection fails
  application construction. `REFUND_BUDGETS_JSON` is obtained with `getOrThrow`;
  environment validation supplies the deliberate default `[]`. Tests construct
  explicit configurations instead of relying on a silent service fallback.
- OWNER reconciliation carries `{ kind: 'owner', userId, organizationId, agentId }`.
  It no longer fabricates an authenticated agent with an empty credential ID.
  Reading and reconciling use an `ExecutionReader` scope. OWNER scopes recheck
  stored OWNER membership in database reads and lease-expiry writes. Dispatch,
  claim and retry still require `AuthenticatedAgent`, including a credential ID.
- Resume/retry use the named `mode: 'resume' | 'retry'` contract. This improves
  call-site clarity without changing leases, attempt budgets or transaction rules.
- Console membership/OWNER predicates remain in data queries. The shared helper
  accepts the required role. Formatting is consistent; the preliminary role read
  does not become the sole authority for returning sensitive data.
- Console assets have one explicit manifest and one wildcard asset handler.
  Parameters only index a Map; they never form filesystem paths. Unknown names
  and traversal-shaped requests return 404. Bytes load once per controller
  instance, not when the module is imported or for every HTTP request.
- Page renderers, shared execution/result rendering, and approval/execution dialogs
  live in `public/console/pages`. App orchestration retains the shared API/session
  boundary. A `getState` accessor avoids retaining a previous signed-in session
  after logout. Page modules use injected helpers rather than independent clients.
- The history filter has a bounded width and the active-agent caption handles
  singular/plural correctly.

## Verification

The missing-config tests failed before the fix, then passed. The ordinary suite
has 105 passing tests; ESLint passes. All 15 cases in the embedded PostgreSQL-
compatible lab pass, including real queries after a forced role change between
preliminary membership lookup and sensitive read. Removing membership before a
list query also stops records from being returned. Human reconciliation with a
former owner's identity is rejected.

DOM tests still cover tenant switching, credential binding, ambiguous-request
replay and approval without automatic dispatch. HTTP tests load every page module
through the allowlist and reject unknown/traversal-shaped asset paths. The native
PostgreSQL concurrency suites and Docker image are checked by the release workflow;
embedded tests do not prove independent-connection race behavior.

No migration or environment variable change is required. The rules for fake
execution and configured daily budgets remain unchanged.

## Follow-up

The items below were addressed by the next operational release; see
[Operational hardening](operational-hardening.md) for exact contracts and limits.

### Original follow-up list

- Sensitive-read audit events across console and approval detail endpoints.
- Action/observation rate limits with explicit agent/organization scopes.
- Suspend/revoke administration and its in-flight execution contract.
- Pending-request and approval expiration; uncertain effects must never be treated
  as failed solely because time elapsed, or have their budget hold released.
- Versioned canonical policy hashes that preserve historical evidence.
- Further extraction of policy/approval gates and execution persistence responsibilities.

These are separate behavior changes, not claims supplied by this refactor.
