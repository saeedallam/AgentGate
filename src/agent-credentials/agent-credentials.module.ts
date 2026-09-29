import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../infrastructure/database/database.module.js';
import { AgentCredentialsController } from './agent-credentials.controller.js';
import { AgentCredentialsService } from './agent-credentials.service.js';
import { AgentKeyService } from './agent-key.service.js';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [AgentCredentialsController],
  providers: [AgentCredentialsService, AgentKeyService],
})
export class AgentCredentialsModule {}
