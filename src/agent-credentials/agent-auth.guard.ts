import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

import type { AgentAuthenticatedRequest } from './agent-authenticated-request.js';
import { AgentAuthenticationService } from './agent-authentication.service.js';

@Injectable()
export class AgentAuthGuard implements CanActivate {
  constructor(private readonly authentication: AgentAuthenticationService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<AgentAuthenticatedRequest>();

    // Never retain an identity supplied before this guard runs.
    delete request.agent;

    const authorization = request.headers.authorization;

    if (typeof authorization !== 'string' || authorization.length > 256) {
      throw new UnauthorizedException('Invalid agent credentials');
    }

    const match = /^Bearer ([^\s]+)$/i.exec(authorization);
    const apiKey = match?.[1];

    if (!apiKey) {
      throw new UnauthorizedException('Invalid agent credentials');
    }

    request.agent = await this.authentication.authenticate(apiKey);

    return true;
  }
}
