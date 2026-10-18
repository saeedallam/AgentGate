import { ServiceUnavailableException } from "@nestjs/common";
import type { ActionRequest } from "../actions/action-request.js";
import { PolicyStore } from "./policy-store.js";
import { PolicyEngine } from "./policy-engine.js";
import {
  policyFingerprint,
  POLICY_HASH_VERSION,
} from "./policy-fingerprint.js";
export function evaluatePolicy(
  request: ActionRequest,
  policies: PolicyStore,
  policyEngine: PolicyEngine,
) {
  try {
    const rules = policies.forOrganization(request.organizationId);
    const result = policyEngine.evaluateDetailed(request, rules);
    return {
      policyDecision: result.decision,
      policyReason: result.reason,
      policyHash: policyFingerprint(rules),
      policyHashVersion: POLICY_HASH_VERSION,
      policyEvaluatedAt: new Date(),
    };
  } catch {
    throw new ServiceUnavailableException("Policy evaluation unavailable");
  }
}
