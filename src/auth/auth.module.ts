import { Module } from '@nestjs/common';
import {
  ThrottlerGuard,
  ThrottlerModule,
} from '@nestjs/throttler';

import { DatabaseModule } from '../infrastructure/database/database.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { PasswordService } from './password.service.js';

@Module({
  imports: [
    DatabaseModule,
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
    ThrottlerGuard,
  ],
  exports: [AuthService],
})
export class AuthModule {}