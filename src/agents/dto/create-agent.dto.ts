import { z } from 'zod';

export const createAgentSchema = z.strictObject({
  organizationId: z.uuid(),
  name: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      'Use lowercase letters, numbers and single hyphens',
    ),
});

export type CreateAgentDto = z.infer<typeof createAgentSchema>;