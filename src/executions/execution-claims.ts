import { ConflictException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { AuthenticatedAgent } from "../agent-credentials/agent-authentication.service.js";
import { RefundBudgetLedger } from "../budgets/refund-budget-ledger.js";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../infrastructure/database/prisma.service.js";
import { retryExecution, transitionExecution } from "./execution-state.js";
import { EXECUTION_LEASE_MS, retryWindow } from "./recovery-contract.js";

// Owns whole transactions; never dispatches a provider.
export class ExecutionClaims {
  constructor(
    private readonly prisma: PrismaService,
    private readonly budgets: RefundBudgetLedger,
  ) {}
  private authorization(
    identity: AuthenticatedAgent,
    approval?: { id: string; requestHash: string },
  ): Prisma.ExecutionWhereInput {
    return {
      organizationId: identity.organizationId,
      agentId: identity.agentId,
      ...(approval
        ? {
            policyDecision: "REQUIRE_APPROVAL",
            requestHash: approval.requestHash,
            approval: {
              is: {
                id: approval.id,
                organizationId: identity.organizationId,
                requestHash: approval.requestHash,
                status: "APPROVED",
                decidedByUserId: { not: null },
                decidedAt: { not: null },
              },
            },
          }
        : { policyDecision: "ALLOW", approval: { is: null } }),
      agent: {
        status: "ACTIVE",
        credentials: { some: { id: identity.credentialId, revokedAt: null } },
      },
    };
  }

  async claim(
    identity: AuthenticatedAgent,
    id: string,
    approval?: { id: string; requestHash: string },
    attemptId: string = randomUUID(),
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Agent" WHERE id = ${identity.agentId}::uuid AND "organizationId" = ${identity.organizationId}::uuid FOR SHARE`;
      const changed = await tx.execution.updateMany({
        where: {
          id,
          ...this.authorization(identity, approval),
          status: "RECEIVED",
          expiresAt: { gt: new Date() },
        },
        data: {
          status: transitionExecution("RECEIVED", "EXECUTING"),
          attemptCount: { increment: 1 },
          leaseExpiresAt: new Date(Date.now() + EXECUTION_LEASE_MS),
          nextRetryAt: null,
        },
      });
      if (changed.count === 0) return false;
      await this.budgets.reserve(
        tx,
        await tx.execution.findUniqueOrThrow({ where: { id } }),
        new Date(),
      );
      await tx.executionAttempt.create({
        data: {
          id: attemptId,
          organizationId: identity.organizationId,
          executionId: id,
          credentialId: identity.credentialId,
          attemptNumber: 1,
        },
      });
      return true;
    });
  }

  async claimRetry(
    identity: AuthenticatedAgent,
    id: string,
    expectedAttemptCount: number,
    attemptId: string,
    approval?: { id: string; requestHash: string },
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Agent" WHERE id = ${identity.agentId}::uuid AND "organizationId" = ${identity.organizationId}::uuid FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM "Execution" WHERE id = ${id}::uuid
        AND "organizationId" = ${identity.organizationId}::uuid AND "agentId" = ${identity.agentId}::uuid FOR UPDATE`;
      const execution = await tx.execution.findFirst({
        where: { id, ...this.authorization(identity, approval) },
      });
      if (!execution)
        throw new ConflictException(
          "Execution is no longer authorized for retry",
        );
      if (execution.attemptCount !== expectedAttemptCount) return false;
      const reason = retryWindow(execution, new Date());
      if (reason)
        throw new ConflictException({
          statusCode: 409,
          error: "Conflict",
          code: reason,
          message: "Execution cannot be retried now",
        });
      const next = execution.attemptCount + 1;
      if (execution.status === "EXECUTING") {
        const old = await tx.executionAttempt.updateMany({
          where: {
            executionId: id,
            attemptNumber: execution.attemptCount,
            status: "EXECUTING",
          },
          data: {
            status: "OUTCOME_UNKNOWN",
            errorCode: "ATTEMPT_LEASE_EXPIRED",
            finishedAt: new Date(),
          },
        });
        if (old.count !== 1)
          throw new ConflictException("Execution attempt missing");
      }
      await tx.execution.update({
        where: { id },
        data: {
          status: retryExecution(execution.status),
          attemptCount: next,
          errorCode: null,
          leaseExpiresAt: new Date(Date.now() + EXECUTION_LEASE_MS),
          nextRetryAt: null,
        },
      });
      await this.budgets.reserve(
        tx,
        { ...execution, attemptCount: next },
        new Date(),
      );
      await tx.executionAttempt.create({
        data: {
          id: attemptId,
          organizationId: identity.organizationId,
          executionId: id,
          credentialId: identity.credentialId,
          attemptNumber: next,
        },
      });
      return true;
    });
  }
}
