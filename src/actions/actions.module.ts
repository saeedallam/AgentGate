import { Module } from '@nestjs/common';
import { AgentCredentialsModule } from '../agent-credentials/agent-credentials.module.js';
import { DatabaseModule } from '../infrastructure/database/database.module.js';
import { ExecutionsService } from '../executions/executions.service.js';
import { FakeCommerceProvider } from '../fake-commerce/fake-commerce.provider.js';
import { ActionsController } from './actions.controller.js';
import { ActionsService } from './actions.service.js';

@Module({
  imports: [DatabaseModule, AgentCredentialsModule],
  controllers: [ActionsController],
  providers: [ExecutionsService, FakeCommerceProvider, ActionsService],
})
export class ActionsModule {}
