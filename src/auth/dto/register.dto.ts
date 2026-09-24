import { z } from 'zod';

import { emailSchema } from './email.schema.js';

export const registerSchema = z.strictObject({
  email: emailSchema,
  password: z.string().min(15).max(128),
});

export type RegisterDto = z.infer<typeof registerSchema>;