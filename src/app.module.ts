import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AgentCredentialsModule } from './agent-credentials/agent-credentials.module.js';
import { AgentsModule } from './agents/agents.module.js';
import { AuthModule } from './auth/auth.module.js';
import { validateEnvironment } from './infrastructure/config/environment.js';
import { DatabaseModule } from './infrastructure/database/database.module.js';
import { HealthController } from './infrastructure/health/health.controller.js';
import { HealthService } from './infrastructure/health/health.service.js';
import { OrganizationsModule } from './organizations/organizations.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnvironment,
    }),
    DatabaseModule,
    OrganizationsModule,
    AuthModule,
    AgentsModule,
    AgentCredentialsModule,
  ],
  controllers: [HealthController],
  providers: [HealthService],
})
export class AppModule {}
