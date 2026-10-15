import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AgentCredentialsModule } from '../agent-credentials/agent-credentials.module.js';
import { DatabaseModule } from '../infrastructure/database/database.module.js';
import { PoliciesModule } from '../policies/policies.module.js';
import { ObservationsService } from './observations.service.js';
import { ActionObservationsController, PolicyStudiesController } from './observations.controller.js';
@Module({ imports: [AuthModule, AgentCredentialsModule, DatabaseModule, PoliciesModule],
  providers: [ObservationsService], controllers: [ActionObservationsController, PolicyStudiesController] })
export class ObservationsModule {}
