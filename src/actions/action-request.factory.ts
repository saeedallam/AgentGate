import { z } from 'zod';

import type { AuthenticatedAgent } from '../agent-credentials/agent-authentication.service.js';
import { ActionRegistry } from './action-registry.js';
import type { ActionEnvironment, ActionRequest } from './action-request.js';

const actionSubmissionSchema = z.strictObject({
  action: z.strictObject({
    name: z.string().min(1).max(100),
  }),

  arguments: z.record(z.string(), z.unknown()),
});

type Clock = () => Date;

export class ActionRequestFactory {
  constructor(
    private readonly registry: ActionRegistry,
    private readonly environment: ActionEnvironment,
    private readonly clock: Clock = () => new Date()
  ) {}

  create(identity: AuthenticatedAgent, input: unknown): ActionRequest {
    const submission = actionSubmissionSchema.parse(input);

    const parsed = this.registry.parse(
      submission.action.name,
      submission.arguments
    );

    const request: ActionRequest = {
      organizationId: identity.organizationId,

      principal: {
        type: 'agent',
        id: identity.agentId,
      },

      action: parsed.action,

      arguments: parsed.arguments,

      context: {
        environment: this.environment,
        requestedAt: this.clock(),
      },
    };

    if (parsed.resource !== undefined) {
      return {
        ...request,
        resource: parsed.resource,
      };
    }

    return request;
  }
}
