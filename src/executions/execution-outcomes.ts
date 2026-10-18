import { ConflictException, NotFoundException } from "@nestjs/common";
import type { AuthenticatedAgent } from "../agent-credentials/agent-authentication.service.js";
import { RefundBudgetLedger } from "../budgets/refund-budget-ledger.js";
import { PrismaService } from "../infrastructure/database/prisma.service.js";
import type { ConfirmedOutcome } from "../providers/action-provider.js";
import { executionScope, type ExecutionReader } from "./execution-reader.js";
import { transitionExecution } from "./execution-state.js";
import { retryDelayMs } from "./recovery-contract.js";

import type { ExecutionOutcome } from "./executions.service.js";

// Owns whole transactions; never dispatches a provider.
export class ExecutionOutcomes {
  constructor(
    private readonly prisma: PrismaService,
    private readonly budgets: RefundBudgetLedger,
    private readonly get: (
      identity: ExecutionReader,
      id: string,
    ) => ReturnType<import("./executions.service.js").ExecutionsService["get"]>,
  ) {}
  async expireLease(identity: ExecutionReader, id: string) {
    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.execution.updateMany({
        where: {
          id,
          ...executionScope(identity),
          recoveryVersion: 1,
          status: "EXECUTING",
          leaseExpiresAt: { lte: new Date() },
        },
        data: {
          status: transitionExecution("EXECUTING", "OUTCOME_UNKNOWN"),
          errorCode: "ATTEMPT_LEASE_EXPIRED",
          leaseExpiresAt: null,
          nextRetryAt: new Date(Date.now() + retryDelayMs(3)),
        },
      });
      if (changed.count === 0) return;
      const attempt = await tx.executionAttempt.updateMany({
        where: { executionId: id, status: "EXECUTING" },
        data: {
          status: "OUTCOME_UNKNOWN",
          errorCode: "ATTEMPT_LEASE_EXPIRED",
          finishedAt: new Date(),
        },
      });
      if (attempt.count !== 1)
        throw new ConflictException("Execution attempt missing");
    });
    return this.get(identity, id);
  }

  async reconcile(
    identity: ExecutionReader,
    id: string,
    outcome: ConfirmedOutcome,
  ) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Execution" WHERE id = ${id}::uuid
        AND "organizationId" = ${identity.organizationId}::uuid AND "agentId" = ${identity.agentId}::uuid FOR UPDATE`;
      const execution = await tx.execution.findFirst({
        where: { id, ...executionScope(identity) },
      });
      if (!execution) throw new NotFoundException("Execution not found");
      if (!["EXECUTING", "OUTCOME_UNKNOWN"].includes(execution.status)) return;
      if (execution.recoveryVersion !== 1)
        throw new ConflictException("Legacy recovery requires manual review");
      const attempts = await tx.executionAttempt.count({
        where: { executionId: id },
      });
      if (attempts !== execution.attemptCount || attempts === 0)
        throw new ConflictException("Execution attempt evidence incomplete");
      const now = new Date();
      await tx.executionAttempt.updateMany({
        where: { executionId: id, status: "EXECUTING" },
        data: {
          status: "OUTCOME_UNKNOWN",
          errorCode: "RECOVERED_PROVIDER_RECEIPT",
          finishedAt: now,
        },
      });
      await tx.executionAttempt.updateMany({
        where: { executionId: id, status: "OUTCOME_UNKNOWN", resolvedAt: null },
        data: { resolvedAt: now, resolvedStatus: outcome.status },
      });
      await this.budgets.settle(tx, id, outcome.status);
      await tx.execution.update({
        where: { id },
        data: {
          status: transitionExecution(execution.status, outcome.status),
          leaseExpiresAt: null,
          nextRetryAt: null,
          ...(outcome.status === "SUCCEEDED"
            ? { result: outcome.result, errorCode: null }
            : { errorCode: outcome.errorCode }),
        },
      });
    });
    return this.get(identity, id);
  }

  async finish(
    identity: AuthenticatedAgent,
    id: string,
    outcome: ExecutionOutcome,
    attemptId?: string,
  ) {
    const status = transitionExecution("EXECUTING", outcome.status);
    await this.prisma.$transaction(async (tx) => {
      const attemptRecord = await tx.executionAttempt.findFirst({
        where: {
          executionId: id,
          organizationId: identity.organizationId,
          ...(attemptId ? { id: attemptId } : { attemptNumber: 1 }),
        },
      });
      if (!attemptRecord)
        throw new ConflictException("Execution attempt missing");
      const changed = await tx.execution.updateMany({
        where: {
          id,
          organizationId: identity.organizationId,
          agentId: identity.agentId,
          status: "EXECUTING",
          attemptCount: attemptRecord.attemptNumber,
        },
        data: {
          status,
          leaseExpiresAt: null,
          nextRetryAt:
            outcome.status === "OUTCOME_UNKNOWN"
              ? new Date(Date.now() + retryDelayMs(attemptRecord.attemptNumber))
              : null,
          ...(outcome.status === "SUCCEEDED"
            ? { result: outcome.result, errorCode: null }
            : { errorCode: outcome.errorCode }),
        },
      });
      if (changed.count !== 1)
        throw new ConflictException("Execution state changed");
      const attempt = await tx.executionAttempt.updateMany({
        where: {
          id: attemptRecord.id,
          executionId: id,
          organizationId: identity.organizationId,
          status: "EXECUTING",
        },
        data: {
          status,
          finishedAt: new Date(),
          errorCode: outcome.status === "SUCCEEDED" ? null : outcome.errorCode,
        },
      });
      if (attempt.count !== 1)
        throw new ConflictException("Execution attempt missing");
      await this.budgets.settle(tx, id, outcome.status);
      if (outcome.status !== "OUTCOME_UNKNOWN") {
        await tx.executionAttempt.updateMany({
          where: {
            executionId: id,
            status: "OUTCOME_UNKNOWN",
            resolvedAt: null,
          },
          data: { resolvedAt: new Date(), resolvedStatus: outcome.status },
        });
      }
    });
    return this.get(identity, id);
  }
}
