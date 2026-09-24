import { z } from 'zod';

import { emailSchema } from './email.schema.js';

export const loginSchema = z.strictObject({
  email: emailSchema,
  password: z.string().min(1).max(128),
});

export type LoginDto = z.infer<typeof loginSchema>;