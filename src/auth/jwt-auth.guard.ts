import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { z } from 'zod';

import type { AuthenticatedRequest } from './authenticated-request.js';

const accessTokenClaimsSchema = z.object({
  sub: z.uuid(),
  iat: z.number().int().nonnegative(),
  exp: z.number().int().positive(),
});

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest>();

    const authorization = request.headers.authorization;

    if (!authorization) {
      throw new UnauthorizedException('Invalid or missing access token');
    }

    const match = /^Bearer ([^\s]+)$/i.exec(authorization);
    const token = match?.[1];

    if (!token) {
      throw new UnauthorizedException('Invalid or missing access token');
    }

    let payload: unknown;

    try {
      payload = await this.jwt.verifyAsync<Record<string, unknown>>(token);
    } catch {
      throw new UnauthorizedException('Invalid or missing access token');
    }

    const result = accessTokenClaimsSchema.safeParse(payload);

    if (!result.success) {
      throw new UnauthorizedException('Invalid or missing access token');
    }

    request.user = {
      id: result.data.sub,
    };

    return true;
  }
}