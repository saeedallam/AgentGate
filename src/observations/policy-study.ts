import { createHash } from 'node:crypto';
import type { Policy, PolicyDecision } from '../policies/policy.js';

export function studyPolicyHash(rules: Policy[]): string {
  // Same snapshot format as enforcement; simulations do not rewrite old evidence.
  return createHash('sha256').update(JSON.stringify({ version: 1, rules })).digest('hex');
}
export function summarizeDecisions(rows: readonly { decision?: PolicyDecision; skipped?: string }[]) {
  return {
    allow: rows.filter(r => r.decision === 'ALLOW').length,
    deny: rows.filter(r => r.decision === 'DENY').length,
    requireApproval: rows.filter(r => r.decision === 'REQUIRE_APPROVAL').length,
    skipped: rows.filter(r => r.skipped !== undefined).length,
  };
}
