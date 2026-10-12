import { POLICY_REASON, type PolicyReason } from './policy-reason.js';
import type { ActionRequest } from '../actions/action-request.js';
import { policiesSchema } from './policy.js';
import type { PolicyCondition, PolicyDecision } from './policy.js';

export class InvalidPolicyConfigurationError extends Error {
  constructor() {
    super('Invalid policy configuration');
    this.name = 'InvalidPolicyConfigurationError';
  }
}

function readField(request: ActionRequest, field: string): unknown {
  switch (field) {
    case 'principal.id': return request.principal.id;
    case 'resource.type': return request.resource?.type;
    case 'resource.id': return request.resource?.id;
    case 'context.environment': return request.context.environment;
    default: {
      const key = field.slice('arguments.'.length);
      return Object.hasOwn(request.arguments, key) ? request.arguments[key] : undefined;
    }
  }
}

function matchesCondition(request: ActionRequest, condition: PolicyCondition): boolean {
  const actual = readField(request, condition.field);
  if (condition.operator === 'EXISTS') return (actual !== undefined) === condition.value;
  // Missing, complex or non-finite values cannot satisfy comparisons, even negative ones.
  if (actual === undefined || actual === null) return false;
  if (!['string', 'number', 'boolean'].includes(typeof actual)) return false;
  if (typeof actual === 'number' && !Number.isFinite(actual)) return false;

  switch (condition.operator) {
    case 'EQ': return actual === condition.value;
    case 'NEQ': return actual !== condition.value;
    case 'IN': return condition.value.some((value) => value === actual);
    case 'NOT_IN': return !condition.value.some((value) => value === actual);
    case 'GT': return typeof actual === 'number' && actual > condition.value;
    case 'GTE': return typeof actual === 'number' && actual >= condition.value;
    case 'LT': return typeof actual === 'number' && actual < condition.value;
    case 'LTE': return typeof actual === 'number' && actual <= condition.value;
  }
}

export class PolicyEngine {
  evaluate(request: ActionRequest, input: unknown): PolicyDecision {
    return this.evaluateDetailed(request, input).decision;
  }

  evaluateDetailed(request: ActionRequest, input: unknown): { decision: PolicyDecision; reason: PolicyReason } {
    const parsed = policiesSchema.safeParse(input);
    if (!parsed.success) throw new InvalidPolicyConfigurationError();

    const matching = parsed.data.filter((policy) =>
      policy.organizationId === request.organizationId
      && policy.actionName === request.action.name
      && policy.conditions.every((condition) => matchesCondition(request, condition))
    );

    if (matching.some((policy) => policy.effect === 'DENY')) return { decision: 'DENY', reason: POLICY_REASON.MATCHED_DENY };
    if (matching.some((policy) => policy.effect === 'REQUIRE_APPROVAL')) return { decision: 'REQUIRE_APPROVAL', reason: POLICY_REASON.MATCHED_APPROVAL };
    if (matching.some((policy) => policy.effect === 'ALLOW')) return { decision: 'ALLOW', reason: POLICY_REASON.MATCHED_ALLOW };
    return { decision: 'DENY', reason: POLICY_REASON.NO_MATCHING_ALLOW };
  }
}
