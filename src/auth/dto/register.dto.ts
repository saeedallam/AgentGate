import { z } from 'zod';

export const registerSchema = z.strictObject({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(320)
    .pipe(z.email()),

  password: z.string().min(15).max(128),
});

export type RegisterDto = z.infer<typeof registerSchema>;