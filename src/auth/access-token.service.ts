import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { ACCESS_TOKEN_TTL_SECONDS } from './token.config.js';

export interface AccessTokenResponse {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
}

@Injectable()
export class AccessTokenService {
  constructor(private readonly jwt: JwtService) {}

  async issue(userId: string): Promise<AccessTokenResponse> {
    const accessToken = await this.jwt.signAsync({
      sub: userId,
    });

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    };
  }
}