import { createHash } from 'node:crypto';
import { PolicyStore } from '../policies/policy-store.js';
import { PolicyEngine } from '../policies/policy-engine.js';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, ServiceUnavailableException } from '@nestjs/common';
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
    private readonly policies: PolicyStore,
    private readonly policyEngine: PolicyEngine,
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
    const evaluate = () => {
      try {
        const rules = this.policies.forOrganization(request.organizationId);
        const result = this.policyEngine.evaluateDetailed(request, rules);
        return {
          policyDecision: result.decision, policyReason: result.reason,
          policyHash: createHash('sha256').update(JSON.stringify({ version: 1, rules })).digest('hex'),
          policyEvaluatedAt: new Date(),
        };
      } catch {
        throw new ServiceUnavailableException('Policy evaluation unavailable');
      }
    };
    const execution = await this.executions.receive(request, keyResult.data, evaluate);
    // Replays report recorded outcomes; they never authorize a fresh dispatch.
    if (execution.status !== 'RECEIVED') return this.executions.get(identity, execution.id);
    if (!execution.policyDecision || !execution.policyReason || !execution.policyHash || !execution.policyEvaluatedAt) {
      throw new ConflictException({
        statusCode: 409, error: 'Conflict', code: 'LEGACY_EXECUTION_REQUIRES_REVIEW',
        message: 'Original policy decision is unavailable; execution requires review',
        executionId: execution.id,
      });
    }
    // Current rules may restrict an old allowance, but cannot upgrade a saved denial.
    const decision = execution.policyDecision === 'ALLOW' ? evaluate().policyDecision : execution.policyDecision;
    if (decision !== 'ALLOW') {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        message: decision === 'REQUIRE_APPROVAL' ? 'Action requires approval' : 'Action denied by policy',
        code: decision === 'REQUIRE_APPROVAL' ? 'POLICY_APPROVAL_REQUIRED' : 'POLICY_DENIED',
        decision,
        executionId: execution.id,
      });
    }
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
