import { ApiResponse } from "@nestjs/swagger";
import { z } from "zod";
import { inputSchema } from "./api-contract.js";

// Response summaries intentionally allow additional documented metadata. They do
// not serialize or filter responses; service allowlists remain authoritative.
const uuid = z.uuid();
const timestamp = z.iso.datetime();
export const executionResponse = z.looseObject({
  id: uuid,
  organizationId: uuid,
  agentId: uuid,
  actionName: z.string(),
  status: z.enum([
    "RECEIVED",
    "EXECUTING",
    "SUCCEEDED",
    "FAILED",
    "OUTCOME_UNKNOWN",
    "DENIED",
  ]),
  result: z.unknown(),
  errorCode: z.string().nullable(),
  requestedAt: timestamp,
  createdAt: timestamp,
  updatedAt: timestamp,
  attempts: z.array(
    z.looseObject({
      id: uuid,
      attemptNumber: z.number().int(),
      status: z.string(),
      startedAt: timestamp,
      finishedAt: timestamp.nullable(),
      errorCode: z.string().nullable(),
    }),
  ),
  approval: z
    .looseObject({
      id: uuid,
      status: z.enum(["PENDING", "APPROVED", "REJECTED"]),
    })
    .nullable(),
});

export function ApiExecutionResponse() {
  return ApiResponse({
    status: 200,
    description:
      "Stored execution and attempts. HTTP 200 does not imply SUCCEEDED: inspect status and errorCode. Replays return existing state without dispatch.",
    schema: inputSchema(executionResponse),
  });
}

export function ApiLoginResponse() {
  return ApiResponse({
    status: 200,
    description:
      "Paste accessToken into the userJwt authorization field. It expires; log in again to obtain a fresh token.",
    schema: inputSchema(
      z.strictObject({
        accessToken: z.string(),
        tokenType: z.literal("Bearer"),
        expiresIn: z.number().int(),
      }),
    ),
  });
}
