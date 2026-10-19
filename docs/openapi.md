# OpenAPI / Swagger

AgentGate serves an interactive API reference at **http://127.0.0.1:3000/docs**
and an OpenAPI 3.0 JSON document at **http://127.0.0.1:3000/openapi.json**.
This is API documentation, not an OpenAI model integration.

## Start on Windows

```cmd
git pull --ff-only
npm ci
npm run prisma:generate
npm run build
set "DATABASE_URL="
set "NODE_ENV=development"
set "API_DOCS_ENABLED=true"
npm start
```

Use the development database from `.env`, with the repository's migrations already
applied. This documentation change introduces no migration. If Windows Application
Control blocks the Argon2 prebuild after npm ci, use the previously configured C++
Build Tools and `npm rebuild argon2 --build-from-source`.

## Authentication and first request

1. Open `/docs`. Expand `auth`, then `POST /auth/login`, click **Try it out**, enter
   your existing user's email/password, and **Execute**. Registration is also
   documented if you need a new user.
2. Copy `accessToken`. Click **Authorize**, paste just the token into **userJwt**,
   and authorize. Do not include the `Bearer ` prefix.
3. User routes still check membership and OWNER permissions. Create/select your
   organization and agent through the documented routes. Credential creation returns
   `apiKey` once; copy it into **agentApiKey**, not userJwt.
4. Action routes use the agent key. `POST /v1/actions` requires a stable
   **Idempotency-Key** and an action body. The example is `refund.create` with
   `amountMinor: 5000` (USD cents, **$50**), against `payment_demo`.
5. The fake lab must be enabled, server policies must authorize the request, and
   that payment must be seeded in the authenticated organization. Swagger does not
   create demo resources or change policy configuration. Follow the Phase B–F guides
   for those prerequisites.

**Execute sends a real request to your running AgentGate instance.** The current
provider is a fake lab, but operations still create/update stored records.
Authorization is not persisted across page reloads. Log out of Swagger when done;
never paste production secrets into screenshots or shared examples.

## Decisions and retries

- HTTP 200 is a transport success, not necessarily execution success. Inspect the
  execution's `status`, `errorCode`, and `attempts`.
- 403 can mean `DENY`, `REQUIRE_APPROVAL`, or another authorization/business block.
  Read `code`, `decision`, `executionId`, and `approvalId` where present.
- Approval decisions require a user JWT with OWNER membership. Approval alone does
  not dispatch. The agent explicitly calls `/v1/executions/{id}/resume` with `{}`.
- Resume/reconcile/retry accept no new action payload. They use the stored request.
- Preserve the same idempotency key and payload when checking a submitted intent.
  A changed payload conflicts. Do not generate a new key to escape an unknown outcome.
- Rate limits, deadlines, suspension, revocation, budget and policy checks remain
  active when using Swagger. No automatic retry is performed by the documentation.

## Exposure and maintenance

`API_DOCS_ENABLED=true|false` overrides the default: enabled only when NODE_ENV is
`development`; disabled in `test` and `production`. Invalid values fail startup.
Both UI and JSON are unavailable when disabled. When explicitly enabled, docs are
publicly readable on the configured listener; they contain route/schema metadata,
not server secrets or database records. Restrict access at your proxy if needed.
Swagger UI assets are served locally; the external validator is disabled.

Controllers carry tags, security and request metadata. Shared Zod validators produce
input schemas; transformations/custom refinements and database authorization still
run only on the server. OpenAPI cannot express every runtime rule. Response summaries
for executions allow additional metadata and do not replace backend response allowlists.
The refund submission union documents the currently registered action; extend it when
adding registry actions. Console static assets are excluded from the API contract.

`test/openapi.test.cjs` checks enabled/disabled behavior, local UI assets, auth schemes,
strict request schemas, input query parameters, no secret disclosure and unchanged
unauthenticated rejection. CI also runs the existing integration suites.
