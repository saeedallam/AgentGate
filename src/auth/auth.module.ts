import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import {
  ThrottlerGuard,
  ThrottlerModule,
} from '@nestjs/throttler';

import { DatabaseModule } from '../infrastructure/database/database.module.js';
import { AccessTokenService } from './access-token.service.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { LoginService } from './login.service.js';
import { PasswordService } from './password.service.js';
import { createTokenOptions } from './token.config.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';

@Module({
  imports: [
    DatabaseModule,

    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        createTokenOptions(config.get<string>('JWT_ACCESS_SECRET')),
    }),

    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 5,
      },
    ]),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    AccessTokenService,
    LoginService,
    ThrottlerGuard,
    JwtAuthGuard
  ],
  exports: [AuthService,JwtAuthGuard,JwtModule],
})
export class AuthModule {}