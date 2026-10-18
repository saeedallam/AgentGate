> Update: `refund_create` no longer accepts model-selected idempotency keys. The host must persist and configure `AGENTGATE_OPERATION_ID`. See [the operational upgrade](operational-hardening.md#mcp-host-owned-operation-identity-breaking-tool-schema-change).

# Phase H — local stdio MCP adapter

The adapter uses the official `@modelcontextprotocol/sdk` 1.32.1. It implements MCP
initialization, tools/list and tools/call through the SDK's stdio transport. An MCP
host starts the process locally; the process sends authenticated HTTP requests to
an independently running AgentGate API. It never connects directly to the database
or provider. It has no OWNER/JWT credential or approval-decision tool.

Official transport/tool reference: https://ts.sdk.modelcontextprotocol.io/server

## Tools

| MCP tool | Existing API path | Effect |
| --- | --- | --- |
| refund_create | POST /v1/actions | Propose the refund under the host-configured operation UUID |
| refund_observe | POST /v1/actions/observe | Persist a non-executing policy preview |
| execution_get | GET /v1/executions/:id | Read own execution |
| execution_resume | POST /v1/executions/:id/resume | Resume exact approved action under current controls |
| execution_retry | POST /v1/executions/:id/retry | Explicit bounded recovery of the same operation |
| execution_reconcile | POST /v1/executions/:id/reconcile | Observe provider evidence and record outcome |

Tool schemas are strict: no organization/agent identity, permission overrides,
replacement resume payload, arbitrary action name, URL or arbitrary headers. The
backend authenticates the configured agent key again on **every call**, so a running
adapter does not preserve authority after revocation/suspension. Listing tool schemas
is not authorization to execute them.

The refund amount is USD cents. The host must persist one operation UUID per intent, and reuse it on adapter restart.
The tool schema has no key field. A new creation intent requires a new host-configured
process; observation and existing-execution tools need no operation UUID.
Do not generate a new key because a reply was lost. Approval-required, denied,
budget-exceeded and auth errors remain tool errors with backend safe response data.
The adapter never auto-approves or automatically retries. Tool annotations describe
behavior to the host; they do not enforce security. Backend checks enforce it.

## Start and configure

Use the project's supported Node version (see package.json), install the lockfile,
build, migrate and start the regular API first. For a host that supports stdio MCP:

```json
{
  "mcpServers": {
    "agentgate": {
      "command": "node",
      "args": ["C:/projects/agentgate/dist/mcp/main.js"],
      "env": {
        "AGENTGATE_URL": "http://127.0.0.1:3000",
        "AGENTGATE_API_KEY": "YOUR_AGENT_API_KEY",
        "AGENTGATE_OPERATION_ID": "YOUR_HOST_PERSISTED_OPERATION_UUID"
      }
    }
  }
}
```

Use the host's secret/environment facilities; never commit an actual key. Host
configuration format varies; the command/args/env above describe the local process.
Launch `node .../dist/mcp/main.js` directly, **not npm**, because npm may print a banner
to stdout. `npm run mcp:start` exists for manual launching only, not as the recommended
stdio host command. The adapter does not import dotenv or print startup banners.
Stdout is exclusively the MCP protocol; startup errors use sanitized stderr.

AGENTGATE_URL must be an operator-configured origin with no credentials, path,
query or fragment. Plain HTTP is accepted only for localhost/127.0.0.1/::1; other
origins require HTTPS. It is a trusted deployment setting, never tool input. No
redirects are followed, so a redirected backend cannot forward the agent secret.
A public remote MCP HTTP/OAuth server is **not** implemented in this phase.

## Failure boundaries

HTTP calls have a 15-second timeout and honor MCP cancellation. Timeout or abort
is not proof of no effect: the API may already have dispatched. `TRANSPORT_UNCERTAIN`
and `BACKEND_UNAVAILABLE` explicitly require inspection/reconciliation or an exact
same-key replay; the adapter sends no automatic second request. Non-JSON, oversized
or server error responses are not echoed as raw stack traces. Responses are capped
at 256 KiB, stdio input buffering at 64 KiB and tool input elements at 50.

The host can cancel a tool call, but cancellation does not roll back already committed
API/provider effects. A process restart loses no execution evidence because it lives
in the API database, not the adapter. No LLM is required for the protocol test.

## Verification

`test/mcp-adapter.test.cjs` uses an actual SDK Client with in-memory MCP transport to
test schemas, names, routes, headers, error redaction and absence of automatic retries.
`test/mcp-flow.integration.cjs` launches the compiled adapter as a **real subprocess
via stdio**, starts the actual HTTP API, and exercises policy denial, same-key replay,
conflict, OWNER approval through the separate HTTP route, resume, unknown-outcome
reconciliation, budget denial, cross-tenant access and key revocation.

```bat
node --test --test-concurrency=1 test/observations.integration.cjs test/mcp-flow.integration.cjs
```

Use the dedicated agentgate_test database and apply all migrations first.
