import { z } from 'zod';

const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor']);
const fieldSchema = z.string().max(160).refine((field) => {
  if (['principal.id', 'resource.type', 'resource.id', 'context.environment'].includes(field)) return true;
  if (!field.startsWith('arguments.')) return false;
  const key = field.slice('arguments.'.length);
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && !forbiddenKeys.has(key);
}, 'Unsupported policy field');
const scalarSchema = z.union([z.string().max(1000), z.number().finite(), z.boolean()]);

export const policyConditionSchema = z.discriminatedUnion('operator', [
  z.strictObject({ field: fieldSchema, operator: z.enum(['EQ', 'NEQ']), value: scalarSchema }),
  z.strictObject({ field: fieldSchema, operator: z.enum(['GT', 'GTE', 'LT', 'LTE']), value: z.number().finite() }),
  z.strictObject({ field: fieldSchema, operator: z.enum(['IN', 'NOT_IN']), value: z.array(scalarSchema).min(1).max(100) }),
  z.strictObject({ field: fieldSchema, operator: z.literal('EXISTS'), value: z.boolean() }),
]);

export const policySchema = z.strictObject({
  organizationId: z.uuid(),
  actionName: z.string().min(1).max(100).regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/),
  effect: z.enum(['ALLOW', 'DENY', 'REQUIRE_APPROVAL']),
  conditions: z.array(policyConditionSchema).max(32),
});
export const policiesSchema = z.array(policySchema).max(1000);
export type PolicyCondition = z.infer<typeof policyConditionSchema>;
export type Policy = z.infer<typeof policySchema>;
export type PolicyDecision = Policy['effect'];
