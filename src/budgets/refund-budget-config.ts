import { z } from 'zod';

const ruleSchema = z.strictObject({
  organizationId: z.uuid(),
  environment: z.enum(['development', 'staging', 'production']),
  currency: z.literal('USD'),
  limitMinor: z.number().int().min(0).max(2_147_483_647),
});
export type RefundBudgetRule = z.infer<typeof ruleSchema>;

export function parseRefundBudgets(raw: string): RefundBudgetRule[] {
  try {
    const rules = z.array(ruleSchema).max(1000).parse(JSON.parse(raw));
    const scopes = rules.map(r => `${r.organizationId}:${r.environment}:${r.currency}`);
    if (new Set(scopes).size !== scopes.length) throw new Error('Duplicate scope');
    return rules;
  } catch {
    throw new Error('Invalid REFUND_BUDGETS_JSON configuration');
  }
}

export function utcBudgetDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
