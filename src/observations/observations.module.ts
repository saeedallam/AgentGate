import { ActionRateGuard } from "../security/action-rate.guard.js";
import { ActionRegistryModule } from "../actions/action-registry.module.js";
import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { AgentCredentialsModule } from "../agent-credentials/agent-credentials.module.js";
import { DatabaseModule } from "../infrastructure/database/database.module.js";
import { PoliciesModule } from "../policies/policies.module.js";
import { ObservationsService } from "./observations.service.js";
import {
  ActionObservationsController,
  PolicyStudiesController,
} from "./observations.controller.js";
@Module({
  imports: [
    ActionRegistryModule,
    AuthModule,
    AgentCredentialsModule,
    DatabaseModule,
    PoliciesModule,
  ],
  providers: [ActionRateGuard, ObservationsService],
  controllers: [ActionObservationsController, PolicyStudiesController],
})
export class ObservationsModule {}
