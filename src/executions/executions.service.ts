import { ConfigService } from '@nestjs/config';
import { parseRefundBudgets } from '../budgets/refund-budget-config.js';
import { RefundBudgetLedger } from '../budgets/refund-budget-ledger.js';
import { BLOCK_CODE } from '../actions/action-block-code.js';
import { EXECUTION_LEASE_MS, retryDelayMs, retryWindow } from './recovery-contract.js';
import type { ConfirmedOutcome } from '../providers/action-provider.js';
import { randomUUID } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import type { AuthenticatedAgent } from '../agent-credentials/agent-authentication.service.js';
import type { ActionRequest } from '../actions/action-request.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../infrastructure/database/prisma.service.js';
import { actionJson } from './action-json.js';
import type { PolicyDecision } from '../policies/policy.js';
import { retryExecution, transitionExecution } from './execution-state.js';

export type ExecutionOutcome =
  | { status: 'SUCCEEDED'; result: Prisma.InputJsonObject }
  | { status: 'FAILED' | 'OUTCOME_UNKNOWN'; errorCode: string };

@Injectable()
export class ExecutionsService {
  private readonly budgets: RefundBudgetLedger;
  constructor(private readonly prisma: PrismaService, @Optional() config?: ConfigService) {
    this.budgets = new RefundBudgetLedger(parseRefundBudgets(config?.get<string>('REFUND_BUDGETS_JSON', '[]') ?? '[]'));
  }

  async receive(request: ActionRequest, idempotencyKey: string, evaluate: () => {
    policyDecision: PolicyDecision; policyReason: string; policyHash: string; policyEvaluatedAt: Date;
  }) {
    const { args, hash } = actionJson(request);
    const scope = { organizationId: request.organizationId, agentId: request.principal.id };
    const lookup = () => this.prisma.execution.findFirst({
      where: { ...scope, idempotencyKey }, include: { approval: true },
    });
    const verify = (existing: NonNullable<Awaited<ReturnType<typeof lookup>>>) => {
      if (existing.requestHash !== hash) throw new ConflictException('Idempotency key already used for a different action');
      return existing;
    };
    const existing = await lookup();
    if (existing) return verify(existing);
    // Evaluate only new requests. A unique constraint selects the winner if requests race.
    const decision = evaluate();
    return this.prisma.$transaction(async tx => {
      const id = randomUUID();
      const inserted = await tx.execution.createMany({ skipDuplicates: true, data: [{
        id, ...scope, idempotencyKey, requestHash: hash, recoveryVersion: 1, ...decision,
        actionName: request.action.name, arguments: args,
        resourceType: request.resource?.type ?? null,
        resourceId: request.resource?.id ?? null,
        environment: request.context.environment,
        requestedAt: request.context.requestedAt,
      }] });
      if (inserted.count === 0) {
        return verify(await tx.execution.findFirstOrThrow({
          where: { ...scope, idempotencyKey }, include: { approval: true },
        }));
      }
      if (decision.policyDecision === 'REQUIRE_APPROVAL') {
        await tx.approval.create({ data: {
          organizationId: scope.organizationId, executionId: id, requestHash: hash,
        } });
      }
      return tx.execution.findUniqueOrThrow({ where: { id }, include: { approval: true } });
    });
  }

  async getStored(identity: AuthenticatedAgent, id: string) {
    const execution = await this.prisma.execution.findFirst({
      where: { id, organizationId: identity.organizationId, agentId: identity.agentId },
      include: { approval: true },
    });
    if (!execution) throw new NotFoundException('Execution not found');
    return execution;
  }

  async denyForPolicyTightening(identity: AuthenticatedAgent, id: string, evidence: {
    policyDecision: Exclude<PolicyDecision, 'ALLOW'>;
    policyHash: string;
    policyEvaluatedAt: Date;
  }) {
    // Competes with claim on the same row. Never reclassify a started execution.
    await this.prisma.execution.updateMany({
      where: { id, organizationId: identity.organizationId, agentId: identity.agentId,
        status: 'RECEIVED', policyDecision: 'ALLOW' },
      data: { status: transitionExecution('RECEIVED', 'DENIED'),
        errorCode: BLOCK_CODE.POLICY_TIGHTENED,
        blockedPolicyDecision: evidence.policyDecision,
        blockedPolicyHash: evidence.policyHash, blockedAt: evidence.policyEvaluatedAt },
    });
    return this.get(identity, id);
  }

  private authorization(identity: AuthenticatedAgent,
    approval?: { id: string; requestHash: string }): Prisma.ExecutionWhereInput {
    return {
      organizationId: identity.organizationId, agentId: identity.agentId,
      ...(approval ? {
        policyDecision: 'REQUIRE_APPROVAL', requestHash: approval.requestHash,
        approval: { is: { id: approval.id, organizationId: identity.organizationId,
          requestHash: approval.requestHash, status: 'APPROVED',
          decidedByUserId: { not: null }, decidedAt: { not: null } } },
      } : { policyDecision: 'ALLOW', approval: { is: null } }),
      agent: { status: 'ACTIVE', credentials: { some: { id: identity.credentialId, revokedAt: null } } },
    };
  }

  async claim(identity: AuthenticatedAgent, id: string,
    approval?: { id: string; requestHash: string }, attemptId: string = randomUUID()): Promise<boolean> {
    return this.prisma.$transaction(async tx => {
      const changed = await tx.execution.updateMany({
        where: { id, ...this.authorization(identity, approval), status: 'RECEIVED' },
        data: { status: transitionExecution('RECEIVED', 'EXECUTING'), attemptCount: { increment: 1 },
          leaseExpiresAt: new Date(Date.now() + EXECUTION_LEASE_MS), nextRetryAt: null },
      });
      if (changed.count === 0) return false;
      await this.budgets.reserve(tx, await tx.execution.findUniqueOrThrow({ where: { id } }), new Date());
      await tx.executionAttempt.create({ data: {
        id: attemptId, organizationId: identity.organizationId, executionId: id,
        credentialId: identity.credentialId, attemptNumber: 1,
      } });
      return true;
    });
  }

  async claimRetry(identity: AuthenticatedAgent, id: string, expectedAttemptCount: number,
    attemptId: string, approval?: { id: string; requestHash: string }): Promise<boolean> {
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Execution" WHERE id = ${id}::uuid
        AND "organizationId" = ${identity.organizationId}::uuid AND "agentId" = ${identity.agentId}::uuid FOR UPDATE`;
      const execution = await tx.execution.findFirst({ where: { id, ...this.authorization(identity, approval) } });
      if (!execution) throw new ConflictException('Execution is no longer authorized for retry');
      if (execution.attemptCount !== expectedAttemptCount) return false;
      const reason = retryWindow(execution, new Date());
      if (reason) throw new ConflictException({ statusCode: 409, error: 'Conflict', code: reason, message: 'Execution cannot be retried now' });
      const next = execution.attemptCount + 1;
      if (execution.status === 'EXECUTING') {
        const old = await tx.executionAttempt.updateMany({
          where: { executionId: id, attemptNumber: execution.attemptCount, status: 'EXECUTING' },
          data: { status: 'OUTCOME_UNKNOWN', errorCode: 'ATTEMPT_LEASE_EXPIRED', finishedAt: new Date() },
        });
        if (old.count !== 1) throw new ConflictException('Execution attempt missing');
      }
      await tx.execution.update({ where: { id }, data: {
        status: retryExecution(execution.status), attemptCount: next, errorCode: null,
        leaseExpiresAt: new Date(Date.now() + EXECUTION_LEASE_MS), nextRetryAt: null,
      } });
      await this.budgets.reserve(tx, { ...execution, attemptCount: next }, new Date());
      await tx.executionAttempt.create({ data: {
        id: attemptId, organizationId: identity.organizationId, executionId: id,
        credentialId: identity.credentialId, attemptNumber: next,
      } });
      return true;
    });
  }

  async expireLease(identity: AuthenticatedAgent, id: string) {
    await this.prisma.$transaction(async tx => {
      const changed = await tx.execution.updateMany({
        where: { id, organizationId: identity.organizationId, agentId: identity.agentId,
          recoveryVersion: 1, status: 'EXECUTING', leaseExpiresAt: { lte: new Date() } },
        data: { status: transitionExecution('EXECUTING', 'OUTCOME_UNKNOWN'), errorCode: 'ATTEMPT_LEASE_EXPIRED',
          leaseExpiresAt: null, nextRetryAt: new Date(Date.now() + retryDelayMs(3)) },
      });
      if (changed.count === 0) return;
      const attempt = await tx.executionAttempt.updateMany({ where: { executionId: id, status: 'EXECUTING' },
        data: { status: 'OUTCOME_UNKNOWN', errorCode: 'ATTEMPT_LEASE_EXPIRED', finishedAt: new Date() } });
      if (attempt.count !== 1) throw new ConflictException('Execution attempt missing');
    });
    return this.get(identity, id);
  }

  async reconcile(identity: AuthenticatedAgent, id: string, outcome: ConfirmedOutcome) {
    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Execution" WHERE id = ${id}::uuid
        AND "organizationId" = ${identity.organizationId}::uuid AND "agentId" = ${identity.agentId}::uuid FOR UPDATE`;
      const execution = await tx.execution.findFirst({ where: { id, organizationId: identity.organizationId, agentId: identity.agentId } });
      if (!execution) throw new NotFoundException('Execution not found');
      if (!['EXECUTING', 'OUTCOME_UNKNOWN'].includes(execution.status)) return;
      if (execution.recoveryVersion !== 1) throw new ConflictException('Legacy recovery requires manual review');
      const attempts = await tx.executionAttempt.count({ where: { executionId: id } });
      if (attempts !== execution.attemptCount || attempts === 0) throw new ConflictException('Execution attempt evidence incomplete');
      const now = new Date();
      await tx.executionAttempt.updateMany({ where: { executionId: id, status: 'EXECUTING' },
        data: { status: 'OUTCOME_UNKNOWN', errorCode: 'RECOVERED_PROVIDER_RECEIPT', finishedAt: now } });
      await tx.executionAttempt.updateMany({ where: { executionId: id, status: 'OUTCOME_UNKNOWN', resolvedAt: null },
        data: { resolvedAt: now, resolvedStatus: outcome.status } });
      await this.budgets.settle(tx, id, outcome.status);
      await tx.execution.update({ where: { id }, data: {
        status: transitionExecution(execution.status, outcome.status), leaseExpiresAt: null, nextRetryAt: null,
        ...(outcome.status === 'SUCCEEDED' ? { result: outcome.result, errorCode: null } : { errorCode: outcome.errorCode }),
      } });
    });
    return this.get(identity, id);
  }

  async finish(identity: AuthenticatedAgent, id: string, outcome: ExecutionOutcome, attemptId?: string) {
    const status = transitionExecution('EXECUTING', outcome.status);
    await this.prisma.$transaction(async tx => {
      const attemptRecord = await tx.executionAttempt.findFirst({ where: {
        executionId: id, organizationId: identity.organizationId,
        ...(attemptId ? { id: attemptId } : { attemptNumber: 1 }),
      } });
      if (!attemptRecord) throw new ConflictException('Execution attempt missing');
      const changed = await tx.execution.updateMany({
        where: { id, organizationId: identity.organizationId, agentId: identity.agentId, status: 'EXECUTING', attemptCount: attemptRecord.attemptNumber },
        data: {
          status, leaseExpiresAt: null,
          nextRetryAt: outcome.status === 'OUTCOME_UNKNOWN' ? new Date(Date.now() + retryDelayMs(attemptRecord.attemptNumber)) : null,
          ...(outcome.status === 'SUCCEEDED'
            ? { result: outcome.result, errorCode: null }
            : { errorCode: outcome.errorCode }),
        },
      });
      if (changed.count !== 1) throw new ConflictException('Execution state changed');
      const attempt = await tx.executionAttempt.updateMany({
        where: { id: attemptRecord.id, executionId: id, organizationId: identity.organizationId, status: 'EXECUTING' },
        data: { status, finishedAt: new Date(), errorCode: outcome.status === 'SUCCEEDED' ? null : outcome.errorCode },
      });
      if (attempt.count !== 1) throw new ConflictException('Execution attempt missing');
      await this.budgets.settle(tx, id, outcome.status);
      if (outcome.status !== 'OUTCOME_UNKNOWN') {
        await tx.executionAttempt.updateMany({ where: { executionId: id, status: 'OUTCOME_UNKNOWN', resolvedAt: null },
          data: { resolvedAt: new Date(), resolvedStatus: outcome.status } });
      }
    });
    return this.get(identity, id);
  }

  async get(identity: AuthenticatedAgent, id: string) {
    const execution = await this.prisma.execution.findFirst({
      where: { id, organizationId: identity.organizationId, agentId: identity.agentId },
      select: {
        id: true, organizationId: true, agentId: true, actionName: true,
        status: true, result: true, errorCode: true, requestedAt: true,
        recoveryVersion: true, attemptCount: true, leaseExpiresAt: true, nextRetryAt: true,
        createdAt: true, updatedAt: true,
        policyDecision: true, policyReason: true, policyHash: true, policyEvaluatedAt: true,
        blockedPolicyDecision: true, blockedPolicyHash: true, blockedAt: true,
        refundBudgetReservation: { select: { day: true, currency: true, amountMinor: true, status: true, settledAt: true } },
        approval: { select: { id: true, status: true, decidedByUserId: true, decidedAt: true } },
        attempts: { orderBy: { attemptNumber: 'asc' }, select: { id: true, attemptNumber: true, status: true, startedAt: true, finishedAt: true, errorCode: true, resolvedAt: true, resolvedStatus: true } },
      },
    });
    if (!execution) throw new NotFoundException('Execution not found');
    return execution;
  }
}
