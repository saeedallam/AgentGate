import { Injectable } from '@nestjs/common';

import {
  AccessTokenService,
  type AccessTokenResponse,
} from './access-token.service.js';
import { AuthService } from './auth.service.js';

@Injectable()
export class LoginService {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: AccessTokenService,
  ) {}

  async login(input: unknown): Promise<AccessTokenResponse> {
    const user = await this.auth.validateCredentials(input);

    return this.tokens.issue(user.id);
  }
}