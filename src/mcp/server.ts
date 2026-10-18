import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

export function parseMcpConfig(input: Record<string, unknown>) {
  try {
    const apiKey = z
      .string()
      .length(106)
      .regex(/^agt_live_[a-f0-9]{32}_[a-f0-9]{64}$/)
      .parse(input.AGENTGATE_API_KEY);
    const base = new URL(
      z.string().parse(input.AGENTGATE_URL ?? "http://127.0.0.1:3000"),
    );
    if (
      base.username ||
      base.password ||
      base.search ||
      base.hash ||
      base.pathname !== "/"
    )
      throw new Error();
    if (
      base.protocol !== "https:" &&
      !(
        base.protocol === "http:" &&
        ["127.0.0.1", "localhost", "[::1]"].includes(base.hostname)
      )
    )
      throw new Error();
    const operationId =
      input.AGENTGATE_OPERATION_ID === undefined
        ? undefined
        : z.uuid().parse(input.AGENTGATE_OPERATION_ID);
    return { apiKey, baseUrl: base.origin, operationId };
  } catch {
    throw new Error(
      "Invalid MCP configuration: use a trusted AgentGate origin and agent API key",
    );
  }
}

const idSchema = z.strictObject({ executionId: z.uuid() });
const refundShape = {
  paymentId: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$(?![\s\S])/),
  amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  currency: z.literal("USD"),
};
const refundSchema = z.strictObject(refundShape);
const result = (
  data: Record<string, unknown>,
  isError = false,
): CallToolResult => ({
  content: [{ type: "text", text: JSON.stringify(data) }],
  structuredContent: data,
  ...(isError ? { isError: true } : {}),
});

// Local stdio adapter only. All authorization, policy and side effects stay in the API.
export function createAgentGateMcpServer(
  input: Record<string, unknown>,
  fetcher: typeof fetch = fetch,
) {
  const config = parseMcpConfig(input);
  const server = new McpServer(
    { name: "agentgate", version: "1.0.0" },
    { maxToolInputElements: 50 },
  );
  const request = async (
    path: string,
    method: "GET" | "POST",
    body: unknown,
    signal: AbortSignal,
    key?: string,
  ) => {
    try {
      const response = await fetcher(config.baseUrl + path, {
        method,
        redirect: "error",
        signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          accept: "application/json",
          ...(method === "POST" ? { "content-type": "application/json" } : {}),
          ...(key ? { "idempotency-key": key } : {}),
        },
        ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
      });
      if (
        response.status >= 500 ||
        (response.status >= 300 && response.status < 400)
      ) {
        await response.body?.cancel();
        return result(
          {
            code: "BACKEND_UNAVAILABLE",
            statusCode: response.status,
            message:
              "Result may be unknown. Inspect the existing execution or replay the exact original idempotency key; never invent a new operation key.",
          },
          true,
        );
      }
      // Bound the backend response and never forward raw non-JSON error pages.
      const reader = response.body?.getReader();
      if (!reader) throw new Error();
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 262144) {
          await reader.cancel();
          throw new Error();
        }
        chunks.push(part.value);
      }
      const decoded = JSON.parse(
        Buffer.concat(chunks).toString("utf8"),
      ) as unknown;
      if (!decoded || typeof decoded !== "object" || Array.isArray(decoded))
        throw new Error();
      return result(
        { statusCode: response.status, result: decoded },
        !response.ok,
      );
    } catch {
      return result(
        {
          code: "TRANSPORT_UNCERTAIN",
          message:
            "No trusted response. Do not create a new operation key. Inspect or reconcile the original execution; this adapter does not automatically retry.",
        },
        true,
      );
    }
  };
  server.registerTool(
    "refund_create",
    {
      description:
        "Submit a USD refund through AgentGate policies, approvals and budget. Amount is cents. The host binds this process to one operation; the model cannot select or rotate its key; an approval-required result is not execution permission.",
      inputSchema: refundSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args, extra) => {
      if (!config.operationId)
        return result(
          {
            code: "HOST_OPERATION_REQUIRED",
            message:
              "The trusted host must configure AGENTGATE_OPERATION_ID and persist it for retries. This tool cannot create operation identities.",
          },
          true,
        );
      return request(
        "/v1/actions",
        "POST",
        { action: { name: "refund.create" }, arguments: args },
        extra.signal,
        "mcp_" + config.operationId,
      );
    },
  );
  server.registerTool(
    "refund_observe",
    {
      description:
        "Record a policy-only preview. Never refunds, reserves budget or grants approval. ALLOW here is not permission to execute.",
      inputSchema: z.strictObject(refundShape),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args, extra) =>
      request(
        "/v1/actions/observe",
        "POST",
        { action: { name: "refund.create" }, arguments: args },
        extra.signal,
      ),
  );
  server.registerTool(
    "execution_get",
    {
      description:
        "Read the authenticated agent’s existing execution and attempts.",
      inputSchema: idSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ executionId }, extra) =>
      request(`/v1/executions/${executionId}`, "GET", undefined, extra.signal),
  );
  for (const operation of ["resume", "retry", "reconcile"] as const) {
    server.registerTool(
      `execution_${operation}`,
      {
        description:
          operation === "resume"
            ? "Resume the exact stored approved action. Accepts no replacement payload; current policy and budget still apply."
            : operation === "retry"
              ? "Explicit bounded recovery of the same operation. Rechecks credentials, policy, approval and retry eligibility. Never create a new execution to recover an unknown outcome."
              : "Ask about the existing provider operation and record confirmed evidence. Does not dispatch a new external effect.",
        inputSchema: idSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: operation !== "reconcile",
          idempotentHint: operation !== "retry",
          openWorldHint: true,
        },
      },
      async ({ executionId }, extra) =>
        request(
          `/v1/executions/${executionId}/${operation}`,
          "POST",
          {},
          extra.signal,
        ),
    );
  }
  return server;
}
