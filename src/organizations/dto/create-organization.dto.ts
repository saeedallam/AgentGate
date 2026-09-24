import { z } from 'zod';

export const createOrganizationSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
});

export type CreateOrganizationDto = z.infer<
  typeof createOrganizationSchema
>;