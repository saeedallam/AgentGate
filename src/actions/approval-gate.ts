import { ConflictException } from "@nestjs/common";
import type { Execution, Approval } from "../generated/prisma/client.js";
import { BLOCK_CODE } from "./action-block-code.js";
import { blocked } from "./action-block.js";
export function requireApprovalBinding(
  execution: Execution & { approval: Approval | null },
) {
  const id = execution.id;
  let binding: { id: string; requestHash: string } | undefined;
  if (execution.policyDecision === "REQUIRE_APPROVAL") {
    const approval = execution.approval;
    if (
      !approval ||
      approval.organizationId !== execution.organizationId ||
      approval.executionId !== id
    ) {
      throw new ConflictException("Approval binding is missing or invalid");
    }
    if (approval.status !== "APPROVED") {
      throw blocked(
        approval.status === "REJECTED"
          ? BLOCK_CODE.APPROVAL_REJECTED
          : BLOCK_CODE.POLICY_APPROVAL_REQUIRED,
        approval.status === "REJECTED"
          ? "Approval was rejected"
          : "Action requires approval",
        {
          executionId: id,
          approvalId: approval.id,
          approvalStatus: approval.status,
        },
      );
    }
    if (!approval.decidedAt || !approval.decidedByUserId)
      throw new ConflictException("Approval decision evidence is incomplete");
    binding = { id: approval.id, requestHash: approval.requestHash };
  }

  return binding;
}
