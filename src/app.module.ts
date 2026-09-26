import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AuthModule } from './auth/auth.module.js';
import { validateEnvironment } from './infrastructure/config/environment.js';
import { DatabaseModule } from './infrastructure/database/database.module.js';
import { HealthController } from './infrastructure/health/health.controller.js';
import { HealthService } from './infrastructure/health/health.service.js';
import { OrganizationsModule } from './organizations/organizations.module.js';
import { AgentsModule } from './agents/agents.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnvironment,
    }),
    DatabaseModule,
    OrganizationsModule,
    AuthModule,
    AgentsModule
  ],
  controllers: [HealthController],
  providers: [HealthService],
})
export class AppModule {}