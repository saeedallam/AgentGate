import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z, ZodError } from 'zod';
import type { AuthenticatedAgent } from '../agent-credentials/agent-authentication.service.js';
import { ExecutionsService, type ExecutionOutcome } from '../executions/executions.service.js';
import { FakeCommerceProvider } from '../fake-commerce/fake-commerce.provider.js';
import { ActionRegistry, UnknownActionError } from './action-registry.js';
import { ActionRequestFactory } from './action-request.factory.js';
import type { ActionEnvironment } from './action-request.js';

@Injectable()
export class ActionsService {
  constructor(
    private readonly executions: ExecutionsService,
    private readonly provider: FakeCommerceProvider,
    private readonly config: ConfigService,
  ) {}

  async submit(identity: AuthenticatedAgent, input: unknown, key: unknown) {
    if (this.config.get('FAKE_EXECUTION_ENABLED') !== true ||
        this.config.get('NODE_ENV') === 'production' ||
        this.config.get('ACTION_ENVIRONMENT') === 'production') {
      throw new ServiceUnavailableException('Fake execution is disabled');
    }
    const keyResult = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$(?![\s\S])/).safeParse(key);
    if (!keyResult.success) throw new BadRequestException('Valid Idempotency-Key required');
    const factory = new ActionRequestFactory(new ActionRegistry(),
      this.config.get<ActionEnvironment>('ACTION_ENVIRONMENT', 'development'));
    let request;
    try {
      request = factory.create(identity, input);
    } catch (error) {
      if (error instanceof ZodError || error instanceof UnknownActionError) {
        throw new BadRequestException('Invalid action request');
      }
      throw error;
    }
    const execution = await this.executions.receive(request, keyResult.data);
    if (!await this.executions.claim(identity, execution.id)) return this.executions.get(identity, execution.id);
    let outcome: ExecutionOutcome;
    try {
      outcome = await this.provider.execute(execution.id, request);
    } catch {
      // A thrown error never proves that a side effect did not happen.
      outcome = { status: 'OUTCOME_UNKNOWN', errorCode: 'PROVIDER_OUTCOME_UNKNOWN' };
    }
    // Persistence failures propagate as server errors. Never dispatch again.
    return this.executions.finish(identity, execution.id, outcome);
  }
}
