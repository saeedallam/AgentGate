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
import { verifiedActionRequest } from '../executions/verified-action-request.js';
import { actionJson } from '../executions/action-json.js';
import type { ActionRequest } from './action-request.js';
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
    this.assertExecutionEnabled();
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
        message: execution.approval?.status === 'APPROVED' ? 'Approval granted; resume the stored execution' : decision === 'REQUIRE_APPROVAL' ? 'Action requires approval' : 'Action denied by policy',
        code: execution.approval?.status === 'APPROVED' ? 'APPROVAL_READY_TO_RESUME' : decision === 'REQUIRE_APPROVAL' ? 'POLICY_APPROVAL_REQUIRED' : 'POLICY_DENIED',
        decision,
        executionId: execution.id,
        approvalId: execution.approval?.id ?? null,
        approvalStatus: execution.approval?.status ?? null,
      });
    }
    if (!await this.executions.claim(identity, execution.id)) return this.executions.get(identity, execution.id);
    return this.dispatch(identity, execution.id, request);
  }

  async resume(identity: AuthenticatedAgent, id: string, input: unknown) {
    this.assertExecutionEnabled();
    if (!z.uuid().safeParse(id).success || !z.strictObject({}).safeParse(input === undefined ? {} : input).success) {
      throw new BadRequestException('Resume accepts an execution id and no action payload');
    }
    const execution = await this.executions.getStored(identity, id);
    // The single existing attempt is never restarted, including ambiguous outcomes.
    if (execution.status !== 'RECEIVED') return this.executions.get(identity, id);
    if (!execution.policyDecision || !execution.policyReason || !execution.policyHash || !execution.policyEvaluatedAt) {
      throw new ConflictException({ statusCode: 409, error: 'Conflict',
        code: 'LEGACY_EXECUTION_REQUIRES_REVIEW', message: 'Original policy decision is unavailable', executionId: id });
    }
    if (execution.policyDecision === 'DENY') {
      throw new ForbiddenException({ statusCode: 403, error: 'Forbidden', code: 'POLICY_DENIED', message: 'Action denied by policy', executionId: id });
    }
    let binding: { id: string; requestHash: string } | undefined;
    if (execution.policyDecision === 'REQUIRE_APPROVAL') {
      const approval = execution.approval;
      if (!approval || approval.organizationId !== execution.organizationId || approval.executionId !== id) {
        throw new ConflictException('Approval binding is missing or invalid');
      }
      if (approval.status !== 'APPROVED') {
        throw new ForbiddenException({ statusCode: 403, error: 'Forbidden',
          code: approval.status === 'REJECTED' ? 'APPROVAL_REJECTED' : 'POLICY_APPROVAL_REQUIRED',
          message: approval.status === 'REJECTED' ? 'Approval was rejected' : 'Action requires approval',
          executionId: id, approvalId: approval.id, approvalStatus: approval.status });
      }
      if (!approval.decidedAt || !approval.decidedByUserId) throw new ConflictException('Approval decision evidence is incomplete');
      binding = { id: approval.id, requestHash: approval.requestHash };
    }
    const request = verifiedActionRequest(execution, binding?.requestHash ?? execution.requestHash ?? '');
    if (request.context.environment !== this.config.get<ActionEnvironment>('ACTION_ENVIRONMENT', 'development')) {
      throw new ConflictException('Stored action belongs to a different environment');
    }
    // A valid historical hash must also describe an action supported by today's registry.
    try {
      const parsed = new ActionRegistry().parse(request.action.name, request.arguments);
      if (actionJson({ ...request, ...parsed }).hash !== execution.requestHash) throw new ConflictException('Stored action definition changed');
    } catch (error) {
      if (error instanceof ZodError || error instanceof UnknownActionError) throw new ConflictException('Stored action is no longer supported');
      throw error;
    }
    let decision;
    try {
      decision = this.policyEngine.evaluate(request, this.policies.forOrganization(request.organizationId));
    } catch {
      throw new ServiceUnavailableException('Policy evaluation unavailable');
    }
    if (decision === 'DENY' || (decision === 'REQUIRE_APPROVAL' && !binding)) {
      throw new ForbiddenException({ statusCode: 403, error: 'Forbidden',
        code: decision === 'DENY' ? 'POLICY_DENIED' : 'POLICY_APPROVAL_REQUIRED',
        message: decision === 'DENY' ? 'Action denied by current policy' : 'Current policy requires approval',
        decision, executionId: id });
    }
    if (!await this.executions.claim(identity, id, binding)) return this.executions.get(identity, id);
    return this.dispatch(identity, id, request);
  }

  private assertExecutionEnabled() {
    if (this.config.get('FAKE_EXECUTION_ENABLED') !== true ||
        this.config.get('NODE_ENV') === 'production' ||
        this.config.get('ACTION_ENVIRONMENT') === 'production') {
      throw new ServiceUnavailableException('Fake execution is disabled');
    }
  }

  private async dispatch(identity: AuthenticatedAgent, id: string, request: ActionRequest) {
    let outcome: ExecutionOutcome;
    try {
      outcome = await this.provider.execute(id, request);
    } catch {
      // A thrown error never proves that a side effect did not happen.
      outcome = { status: 'OUTCOME_UNKNOWN', errorCode: 'PROVIDER_OUTCOME_UNKNOWN' };
    }
    // Persistence failures propagate as server errors. Never dispatch again.
    return this.executions.finish(identity, id, outcome);
  }
}
