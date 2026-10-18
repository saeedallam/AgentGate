import { AgentControlsController } from "../security/agent-controls.controller.js";
import { ActionRateGuard } from "../security/action-rate.guard.js";
import { ActionRegistryModule } from "../actions/action-registry.module.js";
import { RefundBudgetsController } from "../budgets/refund-budgets.controller.js";
import { AuthModule } from "../auth/auth.module.js";
import { RecoveryMonitoringController } from "./recovery-monitoring.controller.js";
import { PoliciesModule } from "../policies/policies.module.js";
import { Module } from "@nestjs/common";
import { AgentCredentialsModule } from "../agent-credentials/agent-credentials.module.js";
import { DatabaseModule } from "../infrastructure/database/database.module.js";
import { ExecutionsService } from "../executions/executions.service.js";
import { FakeCommerceProvider } from "../fake-commerce/fake-commerce.provider.js";
import { ActionsController } from "./actions.controller.js";
import { ActionsService } from "./actions.service.js";

@Module({
  imports: [
    ActionRegistryModule,
    AuthModule,
    DatabaseModule,
    AgentCredentialsModule,
    PoliciesModule,
  ],
  controllers: [
    AgentControlsController,
    ActionsController,
    RecoveryMonitoringController,
    RefundBudgetsController,
  ],
  providers: [
    ActionRateGuard,
    ExecutionsService,
    FakeCommerceProvider,
    ActionsService,
  ],
})
export class ActionsModule {}
