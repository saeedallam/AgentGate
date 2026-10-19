import { ApiQueryInput } from "../openapi/api-contract.js";
import { pageSchema } from "./console.service.js";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import {
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import type { AuthenticatedRequest } from "../auth/authenticated-request.js";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import { ConsoleService } from "./console.service.js";
import { AgentAuthGuard } from "../agent-credentials/agent-auth.guard.js";
import type { AgentAuthenticatedRequest } from "../agent-credentials/agent-authenticated-request.js";

@ApiTags("console")
@Controller("v1/console")
@UseGuards(JwtAuthGuard)
@ApiBearerAuth("userJwt")
export class ConsoleController {
  constructor(private readonly consoleService: ConsoleService) {}
  private actor(request: AuthenticatedRequest) {
    if (!request.user)
      throw new UnauthorizedException("Authentication required");
    return request.user.id;
  }

  @Get("workspaces")
  @Header("Cache-Control", "no-store")
  workspaces(@Req() request: AuthenticatedRequest) {
    return this.consoleService.workspaces(this.actor(request));
  }

  @Get(":organizationId/overview")
  @Header("Cache-Control", "no-store")
  overview(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", new ParseUUIDPipe()) id: string,
  ) {
    return this.consoleService.overview(this.actor(request), id);
  }

  @ApiQueryInput(pageSchema)
  @Get(":organizationId/executions")
  @Header("Cache-Control", "no-store")
  executions(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", new ParseUUIDPipe()) id: string,
    @Query() query: unknown,
  ) {
    return this.consoleService.executions(this.actor(request), id, query);
  }

  @Get(":organizationId/executions/:id")
  @Header("Cache-Control", "no-store")
  execution(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", new ParseUUIDPipe()) org: string,
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    return this.consoleService.execution(this.actor(request), org, id);
  }
}

@ApiTags("console")
@Controller("v1/console-agent")
@UseGuards(AgentAuthGuard)
@ApiBearerAuth("agentApiKey")
export class ConsoleAgentController {
  @Get("identity")
  @Header("Cache-Control", "no-store")
  identity(@Req() request: AgentAuthenticatedRequest) {
    if (!request.agent)
      throw new UnauthorizedException("Authentication required");
    return {
      organizationId: request.agent.organizationId,
      agentId: request.agent.agentId,
    };
  }
}
