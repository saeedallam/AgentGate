import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { DatabaseModule } from "../infrastructure/database/database.module.js";
import {
  ConsoleController,
  ConsoleAgentController,
} from "./console.controller.js";
import { AgentCredentialsModule } from "../agent-credentials/agent-credentials.module.js";
import { ConsoleAssetsController } from "./console-assets.controller.js";
import { ConsoleService } from "./console.service.js";

@Module({
  imports: [AuthModule, DatabaseModule, AgentCredentialsModule],
  controllers: [
    ConsoleAssetsController,
    ConsoleController,
    ConsoleAgentController,
  ],
  providers: [ConsoleService],
})
export class ConsoleModule {}
