import { BadRequestException, ConflictException } from "@nestjs/common";
import { z } from "zod";
import type { Execution } from "../generated/prisma/client.js";
import { BLOCK_CODE } from "./action-block-code.js";
import { blocked } from "./action-block.js";
export function assertRecoveryInput(id: string, input: unknown) {
  if (
    !z.uuid().safeParse(id).success ||
    !z.strictObject({}).safeParse(input === undefined ? {} : input).success
  ) {
    throw new BadRequestException(
      "Recovery accepts an execution id and no action payload",
    );
  }
}

export function assertSnapshot(
  execution: Pick<
    Execution,
    | "id"
    | "policyDecision"
    | "policyReason"
    | "policyHash"
    | "policyEvaluatedAt"
  >,
) {
  if (
    !execution.policyDecision ||
    !execution.policyReason ||
    !execution.policyHash ||
    !execution.policyEvaluatedAt
  ) {
    throw new ConflictException({
      statusCode: 409,
      error: "Conflict",
      code: "LEGACY_EXECUTION_REQUIRES_REVIEW",
      message:
        "Original policy decision is unavailable; execution requires review",
      executionId: execution.id,
    });
  }
  return execution.policyDecision;
}

export function assertNotDenied(execution: Pick<Execution, "id" | "status">) {
  if (execution.status === "DENIED") {
    throw blocked(
      BLOCK_CODE.POLICY_TIGHTENED,
      "Execution permanently blocked after policy tightening",
      { executionId: execution.id },
    );
  }
}
