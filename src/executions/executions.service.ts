import { Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import { BLOCK_CODE } from "../actions/action-block-code.js";
import type { ActionRequest } from "../actions/action-request.js";
import type { AuthenticatedAgent } from "../agent-credentials/agent-authentication.service.js";
import { parseRefundBudgets } from "../budgets/refund-budget-config.js";
import { RefundBudgetLedger } from "../budgets/refund-budget-ledger.js";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../infrastructure/database/prisma.service.js";
import type { PolicyDecision } from "../policies/policy.js";
import type { ConfirmedOutcome } from "../providers/action-provider.js";
import { ExecutionClaims } from "./execution-claims.js";
import { ExecutionOutcomes } from "./execution-outcomes.js";
import { executionScope, type ExecutionReader } from "./execution-reader.js";
import { ExecutionReceipts } from "./execution-receipts.js";
import { transitionExecution } from "./execution-state.js";

export type ExecutionOutcome =
  | { status: "SUCCEEDED"; result: Prisma.InputJsonObject }
  | { status: "FAILED" | "OUTCOME_UNKNOWN"; errorCode: string };

@Injectable()
export class ExecutionsService {
  private readonly receipts: ExecutionReceipts;
  private readonly claims: ExecutionClaims;
  private readonly outcomes: ExecutionOutcomes;
  private readonly budgets: RefundBudgetLedger;
  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.receipts = new ExecutionReceipts(prisma);
    this.budgets = new RefundBudgetLedger(
      parseRefundBudgets(config.getOrThrow<string>("REFUND_BUDGETS_JSON")),
    );
    this.claims = new ExecutionClaims(prisma, this.budgets);
    this.outcomes = new ExecutionOutcomes(
      prisma,
      this.budgets,
      (identity, id) => this.get(identity, id),
    );
  }

  async receive(
    request: ActionRequest,
    idempotencyKey: string,
    evaluate: () => {
      policyDecision: PolicyDecision;
      policyReason: string;
      policyHash: string;
      policyHashVersion?: number;
      policyEvaluatedAt: Date;
    },
  ) {
    return this.receipts.receive(request, idempotencyKey, evaluate);
  }

  async getStored(identity: ExecutionReader, id: string) {
    const execution = await this.prisma.execution.findFirst({
      where: { id, ...executionScope(identity) },
      include: { approval: true },
    });
    if (!execution) throw new NotFoundException("Execution not found");
    return execution;
  }

  async denyForPolicyTightening(
    identity: AuthenticatedAgent,
    id: string,
    evidence: {
      policyDecision: Exclude<PolicyDecision, "ALLOW">;
      policyHash: string;
      policyEvaluatedAt: Date;
    },
  ) {
    // Competes with claim on the same row. Never reclassify a started execution.
    await this.prisma.execution.updateMany({
      where: {
        id,
        organizationId: identity.organizationId,
        agentId: identity.agentId,
        status: "RECEIVED",
        policyDecision: "ALLOW",
      },
      data: {
        status: transitionExecution("RECEIVED", "DENIED"),
        errorCode: BLOCK_CODE.POLICY_TIGHTENED,
        blockedPolicyDecision: evidence.policyDecision,
        blockedPolicyHash: evidence.policyHash,
        blockedAt: evidence.policyEvaluatedAt,
      },
    });
    return this.get(identity, id);
  }

  async claim(
    identity: AuthenticatedAgent,
    id: string,
    approval?: { id: string; requestHash: string },
    attemptId: string = randomUUID(),
  ): Promise<boolean> {
    return this.claims.claim(identity, id, approval, attemptId);
  }

  async claimRetry(
    identity: AuthenticatedAgent,
    id: string,
    expectedAttemptCount: number,
    attemptId: string,
    approval?: { id: string; requestHash: string },
  ): Promise<boolean> {
    return this.claims.claimRetry(
      identity,
      id,
      expectedAttemptCount,
      attemptId,
      approval,
    );
  }

  async expireLease(identity: ExecutionReader, id: string) {
    return this.outcomes.expireLease(identity, id);
  }

  async reconcile(
    identity: ExecutionReader,
    id: string,
    outcome: ConfirmedOutcome,
  ) {
    return this.outcomes.reconcile(identity, id, outcome);
  }

  async finish(
    identity: AuthenticatedAgent,
    id: string,
    outcome: ExecutionOutcome,
    attemptId?: string,
  ) {
    return this.outcomes.finish(identity, id, outcome, attemptId);
  }

  async get(identity: ExecutionReader, id: string) {
    const execution = await this.prisma.execution.findFirst({
      where: { id, ...executionScope(identity) },
      select: {
        id: true,
        organizationId: true,
        agentId: true,
        actionName: true,
        status: true,
        result: true,
        errorCode: true,
        requestedAt: true,
        expiresAt: true,
        policyHashVersion: true,
        recoveryVersion: true,
        attemptCount: true,
        leaseExpiresAt: true,
        nextRetryAt: true,
        createdAt: true,
        updatedAt: true,
        policyDecision: true,
        policyReason: true,
        policyHash: true,
        policyEvaluatedAt: true,
        blockedPolicyDecision: true,
        blockedPolicyHash: true,
        blockedAt: true,
        refundBudgetReservation: {
          select: {
            day: true,
            currency: true,
            amountMinor: true,
            status: true,
            settledAt: true,
          },
        },
        approval: {
          select: {
            id: true,
            status: true,
            decidedByUserId: true,
            decidedAt: true,
          },
        },
        attempts: {
          orderBy: { attemptNumber: "asc" },
          select: {
            id: true,
            attemptNumber: true,
            status: true,
            startedAt: true,
            finishedAt: true,
            errorCode: true,
            resolvedAt: true,
            resolvedStatus: true,
          },
        },
      },
    });
    if (!execution) throw new NotFoundException("Execution not found");
    return execution;
  }
}
