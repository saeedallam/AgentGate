import type { Execution } from '../generated/prisma/client.js';
import { BLOCK_CODE } from './action-block-code.js';
import { blocked } from './action-block.js';
import { createHash } from 'node:crypto';
import { PolicyStore } from '../policies/policy-store.js';
import { PolicyEngine } from '../policies/policy-engine.js';
import { BadRequestException, ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
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
    const evaluate = () => this.evaluatePolicy(request);
    const execution = await this.executions.receive(request, keyResult.data, evaluate);
    // Replays report recorded outcomes; they never authorize a fresh dispatch.
    this.assertNotDenied(execution);
    if (execution.status !== 'RECEIVED') return this.readExecution(identity, execution.id);
    const savedDecision = this.assertSnapshot(execution);
    // Current rules may restrict an old allowance, but cannot upgrade a saved denial.
    const current = execution.policyDecision === 'ALLOW' ? evaluate() : null;
    if (current && current.policyDecision !== 'ALLOW') {
      return this.denyTightened(identity, execution.id, { ...current, policyDecision: current.policyDecision });
    }
    const decision = savedDecision;
    if (decision !== 'ALLOW') {
      throw blocked(
        execution.approval?.status === 'APPROVED' ? BLOCK_CODE.APPROVAL_READY_TO_RESUME
          : decision === 'REQUIRE_APPROVAL' ? BLOCK_CODE.POLICY_APPROVAL_REQUIRED : BLOCK_CODE.POLICY_DENIED,
        execution.approval?.status === 'APPROVED' ? 'Approval granted; resume the stored execution'
          : decision === 'REQUIRE_APPROVAL' ? 'Action requires approval' : 'Action denied by policy',
        { decision, executionId: execution.id,
          approvalId: execution.approval?.id ?? null, approvalStatus: execution.approval?.status ?? null },
      );
    }
    if (!await this.executions.claim(identity, execution.id)) return this.readExecution(identity, execution.id);
    return this.dispatch(identity, execution.id, request);
  }

  async resume(identity: AuthenticatedAgent, id: string, input: unknown) {
    this.assertExecutionEnabled();
    if (!z.uuid().safeParse(id).success || !z.strictObject({}).safeParse(input === undefined ? {} : input).success) {
      throw new BadRequestException('Resume accepts an execution id and no action payload');
    }
    const execution = await this.executions.getStored(identity, id);
    // The single existing attempt is never restarted, including ambiguous outcomes.
    this.assertNotDenied(execution);
    if (execution.status !== 'RECEIVED') return this.readExecution(identity, id);
    this.assertSnapshot(execution);
    if (execution.policyDecision === 'DENY') {
      throw blocked(BLOCK_CODE.POLICY_DENIED, 'Action denied by policy', { executionId: id });
    }
    let binding: { id: string; requestHash: string } | undefined;
    if (execution.policyDecision === 'REQUIRE_APPROVAL') {
      const approval = execution.approval;
      if (!approval || approval.organizationId !== execution.organizationId || approval.executionId !== id) {
        throw new ConflictException('Approval binding is missing or invalid');
      }
      if (approval.status !== 'APPROVED') {
        throw blocked(
          approval.status === 'REJECTED' ? BLOCK_CODE.APPROVAL_REJECTED : BLOCK_CODE.POLICY_APPROVAL_REQUIRED,
          approval.status === 'REJECTED' ? 'Approval was rejected' : 'Action requires approval',
          { executionId: id, approvalId: approval.id, approvalStatus: approval.status },
        );
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
    const current = this.evaluatePolicy(request);
    const decision = current.policyDecision;
    if (execution.policyDecision === 'ALLOW' && decision !== 'ALLOW') {
      return this.denyTightened(identity, id, { ...current, policyDecision: decision });
    }
    if (decision === 'DENY' || (decision === 'REQUIRE_APPROVAL' && !binding)) {
      throw blocked(decision === 'DENY' ? BLOCK_CODE.POLICY_DENIED : BLOCK_CODE.POLICY_APPROVAL_REQUIRED,
        decision === 'DENY' ? 'Action denied by current policy' : 'Current policy requires approval',
        { decision, executionId: id });
    }
    if (!await this.executions.claim(identity, id, binding)) return this.readExecution(identity, id);
    return this.dispatch(identity, id, request);
  }

  private assertSnapshot(execution: Pick<Execution,
    'id' | 'policyDecision' | 'policyReason' | 'policyHash' | 'policyEvaluatedAt'>) {
    if (!execution.policyDecision || !execution.policyReason || !execution.policyHash || !execution.policyEvaluatedAt) {
      throw new ConflictException({ statusCode: 409, error: 'Conflict',
        code: 'LEGACY_EXECUTION_REQUIRES_REVIEW',
        message: 'Original policy decision is unavailable; execution requires review', executionId: execution.id });
    }
    return execution.policyDecision;
  }

  private assertNotDenied(execution: Pick<Execution, 'id' | 'status'>) {
    if (execution.status === 'DENIED') {
      throw blocked(BLOCK_CODE.POLICY_TIGHTENED,
        'Execution permanently blocked after policy tightening', { executionId: execution.id });
    }
  }

  private async readExecution(identity: AuthenticatedAgent, id: string) {
    const execution = await this.executions.get(identity, id);
    this.assertNotDenied(execution);
    return execution;
  }

  private async denyTightened(identity: AuthenticatedAgent, id: string,
    evidence: Parameters<ExecutionsService['denyForPolicyTightening']>[2]) {
    const execution = await this.executions.denyForPolicyTightening(identity, id, evidence);
    this.assertNotDenied(execution);
    // Claim may have won before the denial write: return its actual state.
    return execution;
  }

  private evaluatePolicy(request: ActionRequest) {
    try {
      const rules = this.policies.forOrganization(request.organizationId);
      const result = this.policyEngine.evaluateDetailed(request, rules);
      return { policyDecision: result.decision, policyReason: result.reason,
        policyHash: createHash('sha256').update(JSON.stringify({ version: 1, rules })).digest('hex'),
        policyEvaluatedAt: new Date() };
    } catch {
      throw new ServiceUnavailableException('Policy evaluation unavailable');
    }
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
