import type { JwtModuleOptions } from '@nestjs/jwt';
import { z } from 'zod';

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

const secretSchema = z.string().regex(/^[a-f0-9]{64}$/i);

export function createTokenOptions(secret: unknown): JwtModuleOptions {
  const result = secretSchema.safeParse(secret);

  if (!result.success) {
    throw new Error(
      'JWT_ACCESS_SECRET must contain exactly 64 hexadecimal characters',
    );
  }

  return {
    secret: Buffer.from(result.data, 'hex'),

    signOptions: {
      algorithm: 'HS256',
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      issuer: 'agentgate',
      audience: 'agentgate-api',
    },

    verifyOptions: {
      algorithms: ['HS256'],
      issuer: 'agentgate',
      audience: 'agentgate-api',
    },
  };
}