# Phase B — Action Core

AgentGate remains a general action safety product. This phase runs only the internal Fake Commerce lab, explicitly enabled by the operator. It does not authorize real refunds. Policies come next in Phase C.

## Architecture and why it exists

```mermaid
flowchart TD
  H["POST /v1/actions"] --> G["AgentAuthGuard"]
  G --> C["ActionsController"]
  C --> S["ActionsService"]
  S --> F["ActionRequestFactory + Registry"]
  F --> E["ExecutionsService"]
  E --> D["PostgreSQL: request + attempt"]
  S --> P["FakeCommerceProvider"]
  P --> L["Tenant-owned FakePayment"]
  P --> S
  S --> E
```

The naive approach calls a provider in the controller, then saves success. A crash or retry can repeat the effect, and a timeout can be mistaken for failure.

Here the controller only handles transport. ActionsService normalizes and coordinates. ExecutionsService persists the request, atomically claims it and records the outcome. FakeCommerceProvider owns commerce details. We do not add a generic repository or adapter interface with only one implementation.

## Data and lifecycle

- Execution is the requested action and current outcome.
- ExecutionAttempt records the dispatch, credential ID, start/end and outcome. This phase permits one attempt per execution; retry/reconciliation is Phase E work.
- FakePayment is operator-seeded lab data, scoped by organization. Agent input cannot create or assign ownership.
- New nullable idempotencyKey/requestHash columns preserve earlier Execution records. The HTTP endpoint requires a key for every new request.
- The key is unique per organization and agent. Same key and payload returns the same execution; changed payload returns 409. The canonical digest includes environment and resource but excludes receipt time.
- This digest supports replay matching only; it is not the future approval-integrity feature.
- Claim uses updateMany WHERE status=RECEIVED and current active agent/unrevoked credential. count=1 wins. Claim and attempt insertion are in one transaction.
- The fake effect happens outside that transaction. Final execution and attempt updates happen in another transaction.
- FakePayment's conditional update prevents two requests refunding the same lab payment. This lab permits a single refund per payment, even if partial.
- Read scope includes organization AND agent. Another agent in the same organization also receives 404.

## Important syntax

- `@UseGuards(AgentAuthGuard)`: authenticate before the controller runs.
- `@Headers('idempotency-key')`: extracts the header; runtime validation still follows.
- `Prisma.InputJsonObject`: persistence input contract; actionJson validates JSON values instead of an unsafe type assertion.
- `updateMany` returns `count`: conditional ownership of the transition, without a read-then-write race.
- `$transaction(async tx => ...)`: commit claim plus attempt together, or roll back both.
- Discriminated union `ExecutionOutcome`: success requires a result; failed/unknown require a stable errorCode.
- `catch` around the provider only: unexpected provider errors become unknown; persistence errors remain server errors.
- `select`: response exposes an explicit field list, excluding hashes, keys and unrestricted provider data.
- The authentication service is exported alongside the guard so Nest can resolve its dependency in the consuming module.

## Outcomes and limitations

POST returns 200 with the execution resource. Always inspect status; 200 does not mean the refund succeeded. A concurrent replay may see EXECUTING; poll GET /v1/executions/:id.

Server-owned FAKE_COMMERCE_SCENARIO values:

| Scenario | Effect | Recorded outcome |
| --- | --- | --- |
| success | Updates fake payment | SUCCEEDED |
| reject | None | FAILED |
| delayed | Updates after a short delay | SUCCEEDED |
| error | Simulates ambiguous provider 500 | OUTCOME_UNKNOWN |
| timeout | Simulates ambiguous timeout without effect | OUTCOME_UNKNOWN |
| unknown | Updates payment then loses the response | OUTCOME_UNKNOWN |

Missing payment, over-refund/currency mismatch and duplicate fake refund yield FAILED with stable error codes.

Unknown outcomes are never automatically retried. A process crash or database failure after dispatch can leave EXECUTING with an unfinished attempt; it must be treated as potentially effected. This phase provides evidence but no automatic recovery worker, reconciliation endpoint or exactly-once guarantee. Suspension/revocation checked at claim time cannot cancel effects already in flight.

Attempt history is not a complete audit system. Advanced policy, approval and distributed execution controls remain later phases.

## Windows setup and Postman

After pulling, apply migrations to your development database (use a normal development CMD, not one with DATABASE_URL pointing at agentgate_test):

```cmd
npx prisma migrate deploy
npm run prisma:generate
npm run build
```

Add to local .env:

```dotenv
ACTION_ENVIRONMENT=development
FAKE_EXECUTION_ENABLED=true
FAKE_COMMERCE_SCENARIO=success
```

The lab is disabled by default and refuses execution if NODE_ENV or ACTION_ENVIRONMENT is production. Restart the app after changing scenario/configuration.

Use existing management routes to register/login, create an organization and agent, then issue its API key. Seed a payment for that organization:

```cmd
node scripts/seed-fake-payment.mjs YOUR_ORGANIZATION_UUID payment_demo 10000
npm start
```

Seed uses create, never resets an already-refunded payment. Use a new payment ID for a fresh experiment.

In Postman:

- POST `http://localhost:3000/v1/actions`
- Authorization: Bearer Token = agent API key (not user JWT).
- Header `Idempotency-Key: refund-demo-001`.
- Body / raw / JSON:

```json
{
  "action": { "name": "refund.create" },
  "arguments": {
    "paymentId": "payment_demo",
    "amountMinor": 5000,
    "currency": "USD"
  }
}
```

Expect status SUCCEEDED and result.simulated=true. Repeat unchanged with the same key: same execution ID and one attempt. Change amount with that key: 409. Use a different key for the already-refunded payment: FAILED / PAYMENT_ALREADY_REFUNDED.

GET `http://localhost:3000/v1/executions/EXECUTION_UUID` with the same agent token reads the record.

Malformed input/missing key: 400; invalid/revoked/suspended credential: 401; another agent's execution: 404; disabled/production fake lab: 503.

## Tests

```cmd
npm test
npm run lint
```

In a separate test CMD:

```cmd
set "TEST_DATABASE_URL=postgresql://agentgate:local-development-only@localhost:5432/agentgate_test"
set "DATABASE_URL=%TEST_DATABASE_URL%"
npx prisma migrate deploy
npm run build
node --test test/actions-http.integration.cjs test/execution-model.integration.cjs
```

The HTTP integration test uses real Nest/Fastify/guards/Prisma, generated credentials and isolated fixtures. It covers tenant/resource isolation, duplicate and concurrent requests, conflicting key reuse, attempted trust-field injection, disabled lab, suspension/revocation and provider outcomes. Test fixtures are removed in dependency order.
