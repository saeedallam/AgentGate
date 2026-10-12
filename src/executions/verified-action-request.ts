import { ConflictException } from '@nestjs/common';
import { z } from 'zod';
import type { Execution } from '../generated/prisma/client.js';
import type { ActionRequest } from '../actions/action-request.js';
import { actionJson } from './action-json.js';

type StoredAction = Pick<Execution,
  'organizationId' | 'agentId' | 'actionName' | 'arguments' | 'resourceType'
  | 'resourceId' | 'environment' | 'requestedAt' | 'requestHash'>;

// Reconstruct from storage, never from the decision HTTP body.
export function verifiedActionRequest(execution: StoredAction, approvalHash: string): ActionRequest {
  const invalid = () => new ConflictException({
    statusCode: 409, error: 'Conflict', code: 'ACTION_INTEGRITY_MISMATCH',
    message: 'Stored action does not match its approval',
  });
  const args = z.record(z.string(), z.json()).safeParse(execution.arguments);
  if (!args.success || !execution.requestHash || !approvalHash
    || (execution.resourceType === null) !== (execution.resourceId === null)) throw invalid();
  const request: ActionRequest = {
    organizationId: execution.organizationId,
    principal: { type: 'agent', id: execution.agentId },
    action: { name: execution.actionName },
    arguments: args.data,
    ...(execution.resourceType !== null && execution.resourceId !== null
      ? { resource: { type: execution.resourceType, id: execution.resourceId } } : {}),
    context: { environment: execution.environment, requestedAt: execution.requestedAt },
  };
  const { hash } = actionJson(request);
  if (hash !== execution.requestHash || hash !== approvalHash) throw invalid();
  return request;
}
