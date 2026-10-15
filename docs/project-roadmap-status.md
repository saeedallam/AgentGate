# AgentGate roadmap status

The initial **refund.create + Fake Commerce** vertical slice now covers A–H. This
means the scoped roadmap's runnable core is implemented; it is not a claim that all
future product ideas or production rollout requirements are complete.

| Phase | Implemented |
| --- | --- |
| A | User auth, tenant membership, agents, hashed credentials, active/revoked checks |
| B | Validated action contract, receipts, execution and attempts, fake provider |
| C | Deterministic policies, frozen initial decisions and policy tightening |
| D | Exact-action approval binding, OWNER decision and protected resume |
| E | Stable operation keys, durable fake receipts, fenced bounded retries/reconciliation |
| F | Opt-in daily USD budget with atomic reservation/settlement |
| G | Non-executing observation and OWNER historical policy simulation |
| H | SDK-backed local stdio MCP tools over the protected HTTP API |

## Explicit boundaries

- Only refund.create is registered. Commerce is a test environment, not the product
  boundary. More actions/providers are future vertical slices.
- The provider is fake, disabled by default and prohibited in production. External
  effect guarantees require the real provider's idempotency/reconciliation contract.
- MCP transport is local stdio, not a public remote OAuth MCP server.
- Observation/simulation is policy-only and never disables live enforcement.
- Policies and budget rules are server-owned startup configuration, not DB policy
  editing. All serving nodes must share compatible snapshots/version.
- General action/API rate limits, suspend/revoke administration endpoints, broader
  audit trail, automatic recovery/cleanup workers, approval expiry, velocity limits,
  total cross-day exposure limits and a production console remain future work.
- The existing UI prototype is separate from this backend task. No real payment,
  email, cloud deployment, billing or production-readiness claim is introduced.

## Combined teaching order

The learner requested implementation first and a joint explanation afterward:
1. Trace an authenticated request through normalization and tenant isolation.
2. Policy evidence, approval binding and the conditional execution claim.
3. Phase E operation vs attempt, lease, fencing, durable receipts and reconciliation.
4. Phase F reserved vs consumed money, atomic admission and unknown holds.
5. Phase G would-decisions vs permission and suitable historical evidence.
6. Phase H protocol transport vs the backend security boundary.
7. Read representative tests and explain what each failure would mean.

Keep explanations and exercises separate from claims of learner understanding.
