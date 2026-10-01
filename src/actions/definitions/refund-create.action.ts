import { z } from 'zod';

const refundArgumentsSchema = z.strictObject({
  paymentId: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$(?![\s\S])/),

  amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),

  currency: z.literal('USD'),
});

export function parseRefundCreateArguments(input: unknown) {
  return refundArgumentsSchema.parse(input);
}
