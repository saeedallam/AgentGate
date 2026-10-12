import { BLOCK_CODE } from '../actions/action-block-code.js';
import { randomUUID } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthenticatedAgent } from '../agent-credentials/agent-authentication.service.js';
import type { ActionRequest } from '../actions/action-request.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../infrastructure/database/prisma.service.js';
import { actionJson } from './action-json.js';
import type { PolicyDecision } from '../policies/policy.js';
import { transitionExecution } from './execution-state.js';

export type ExecutionOutcome =
  | { status: 'SUCCEEDED'; result: Prisma.InputJsonObject }
  | { status: 'FAILED' | 'OUTCOME_UNKNOWN'; errorCode: string };

@Injectable()
export class ExecutionsService {
  constructor(private readonly prisma: PrismaService) {}

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
        id, ...scope, idempotencyKey, requestHash: hash, ...decision,
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

  async claim(identity: AuthenticatedAgent, id: string,
    approval?: { id: string; requestHash: string }): Promise<boolean> {
    return this.prisma.$transaction(async tx => {
      const changed = await tx.execution.updateMany({
        where: {
          id, organizationId: identity.organizationId, agentId: identity.agentId,
          status: 'RECEIVED',
          ...(approval ? {
            policyDecision: 'REQUIRE_APPROVAL' as const,
            requestHash: approval.requestHash,
            approval: { is: {
              id: approval.id, organizationId: identity.organizationId, executionId: id,
              requestHash: approval.requestHash, status: 'APPROVED' as const,
              decidedByUserId: { not: null }, decidedAt: { not: null },
            } },
          } : { policyDecision: 'ALLOW' as const, approval: { is: null } }),
          agent: { status: 'ACTIVE', credentials: { some: {
            id: identity.credentialId, revokedAt: null,
          } } },
        },
        data: { status: transitionExecution('RECEIVED', 'EXECUTING') },
      });
      if (changed.count === 0) return false;
      await tx.executionAttempt.create({ data: {
        organizationId: identity.organizationId, executionId: id,
        credentialId: identity.credentialId,
      } });
      return true;
    });
  }

  async finish(identity: AuthenticatedAgent, id: string, outcome: ExecutionOutcome) {
    const status = transitionExecution('EXECUTING', outcome.status);
    await this.prisma.$transaction(async tx => {
      const changed = await tx.execution.updateMany({
        where: { id, organizationId: identity.organizationId, agentId: identity.agentId, status: 'EXECUTING' },
        data: {
          status,
          ...(outcome.status === 'SUCCEEDED'
            ? { result: outcome.result, errorCode: null }
            : { errorCode: outcome.errorCode }),
        },
      });
      if (changed.count !== 1) throw new ConflictException('Execution state changed');
      const attempt = await tx.executionAttempt.updateMany({
        where: { executionId: id, organizationId: identity.organizationId, status: 'EXECUTING' },
        data: { status, finishedAt: new Date(), errorCode: outcome.status === 'SUCCEEDED' ? null : outcome.errorCode },
      });
      if (attempt.count !== 1) throw new ConflictException('Execution attempt missing');
    });
    return this.get(identity, id);
  }

  async get(identity: AuthenticatedAgent, id: string) {
    const execution = await this.prisma.execution.findFirst({
      where: { id, organizationId: identity.organizationId, agentId: identity.agentId },
      select: {
        id: true, organizationId: true, agentId: true, actionName: true,
        status: true, result: true, errorCode: true, requestedAt: true,
        createdAt: true, updatedAt: true,
        policyDecision: true, policyReason: true, policyHash: true, policyEvaluatedAt: true,
        blockedPolicyDecision: true, blockedPolicyHash: true, blockedAt: true,
        approval: { select: { id: true, status: true, decidedByUserId: true, decidedAt: true } },
        attempts: { select: { id: true, status: true, startedAt: true, finishedAt: true, errorCode: true } },
      },
    });
    if (!execution) throw new NotFoundException('Execution not found');
    return execution;
  }
}
