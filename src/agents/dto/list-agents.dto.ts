import { z } from 'zod';

const integerQuerySchema = z
  .string()
  .regex(/^\d+$/)
  .transform(Number)
  .pipe(z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER));

export const listAgentsSchema = z.strictObject({
  organizationId: z.uuid(),

  limit: integerQuerySchema
    .pipe(z.number().min(1).max(100))
    .default(20),

  offset: integerQuerySchema.default(0),
});

export type ListAgentsDto = z.infer<typeof listAgentsSchema>;