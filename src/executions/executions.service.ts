import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthenticatedAgent } from '../agent-credentials/agent-authentication.service.js';
import type { ActionRequest } from '../actions/action-request.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../infrastructure/database/prisma.service.js';
import { actionJson } from './action-json.js';
import { transitionExecution } from './execution-state.js';

export type ExecutionOutcome =
  | { status: 'SUCCEEDED'; result: Prisma.InputJsonObject }
  | { status: 'FAILED' | 'OUTCOME_UNKNOWN'; errorCode: string };

@Injectable()
export class ExecutionsService {
  constructor(private readonly prisma: PrismaService) {}

  async receive(request: ActionRequest, idempotencyKey: string) {
    const { args, hash } = actionJson(request);
    const scope = { organizationId: request.organizationId, agentId: request.principal.id };
    try {
      return await this.prisma.execution.create({ data: {
        ...scope, idempotencyKey, requestHash: hash,
        actionName: request.action.name, arguments: args,
        resourceType: request.resource?.type ?? null,
        resourceId: request.resource?.id ?? null,
        environment: request.context.environment,
        requestedAt: request.context.requestedAt,
      } });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
      const existing = await this.prisma.execution.findFirst({
        where: { ...scope, idempotencyKey },
      });
      if (!existing) throw error;
      if (existing.requestHash !== hash) throw new ConflictException('Idempotency key already used for a different action');
      return existing;
    }
  }

  async claim(identity: AuthenticatedAgent, id: string): Promise<boolean> {
    return this.prisma.$transaction(async tx => {
      const changed = await tx.execution.updateMany({
        where: {
          id, organizationId: identity.organizationId, agentId: identity.agentId,
          status: 'RECEIVED',
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
        attempts: { select: { id: true, status: true, startedAt: true, finishedAt: true, errorCode: true } },
      },
    });
    if (!execution) throw new NotFoundException('Execution not found');
    return execution;
  }
}
