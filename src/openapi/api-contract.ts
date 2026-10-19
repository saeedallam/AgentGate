import { applyDecorators } from "@nestjs/common";
import { ApiBody, ApiOperation, ApiResponse, ApiQuery } from "@nestjs/swagger";
import type { SchemaObject } from "@nestjs/swagger";
import { z } from "zod";

// Document input, not transformed output. Zod remains the runtime authority;
// custom refinements (membership, uniqueness, policy checks) run on the server.
export function inputSchema(schema: z.ZodType): SchemaObject {
  return z.toJSONSchema(schema, {
    target: "openapi-3.0",
    io: "input",
  }) as SchemaObject;
}

export function ApiInput(schema: z.ZodType, example?: unknown) {
  return ApiBody({
    schema: {
      ...inputSchema(schema),
      ...(example === undefined ? {} : { example }),
    },
  });
}

export function ApiQueryInput(schema: z.ZodType) {
  const json = inputSchema(schema);
  return applyDecorators(
    ...Object.entries(json.properties ?? {}).map(([name, property]) =>
      ApiQuery({
        name,
        required: json.required?.includes(name) ?? false,
        schema: property,
      }),
    ),
  );
}

export function ApiErrors(summary: string) {
  return applyDecorators(
    ApiOperation({ summary }),
    ...Object.entries({
      400: "Invalid input. Server-side strict validation rejects unexpected fields.",
      401: "Missing, invalid or expired credentials.",
      403: "Operation blocked by authorization, policy, approval or budget. Inspect code and decision; this is not permission to retry.",
      404: "Resource unavailable within the authenticated scope.",
      409: "Conflicting intent, finalized decision, expired authority or unavailable evidence.",
      429: "Rate limit exceeded.",
      503: "Service unavailable. Check an existing execution outcome before retrying an action.",
    }).map(([status, description]) =>
      ApiResponse({ status: Number(status), description }),
    ),
  );
}
