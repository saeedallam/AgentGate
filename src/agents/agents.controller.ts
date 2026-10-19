import { ApiInput, ApiQueryInput, ApiErrors } from "../openapi/api-contract.js";
import { createAgentSchema } from "./dto/create-agent.dto.js";
import { listAgentsSchema } from "./dto/list-agents.dto.js";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";

import type { AuthenticatedRequest } from "../auth/authenticated-request.js";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import { AgentsService } from "./agents.service.js";

@ApiTags("agents")
@Controller("agents")
@UseGuards(JwtAuthGuard)
@ApiBearerAuth("userJwt")
export class AgentsController {
  constructor(private readonly agents: AgentsService) {}

  @ApiErrors("Create an agent in an authorized organization")
  @ApiInput(createAgentSchema)
  @Post()
  create(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.agents.createForUser(this.getUserId(request), body);
  }

  @ApiQueryInput(listAgentsSchema)
  @Get()
  list(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    return this.agents.listForUser(this.getUserId(request), query);
  }

  @Get(":id")
  get(
    @Req() request: AuthenticatedRequest,
    @Param("id", new ParseUUIDPipe({ version: "4" }))
    agentId: string,
    @Query("organizationId", new ParseUUIDPipe({ version: "4" }))
    organizationId: string,
  ) {
    return this.agents.getForUser(
      this.getUserId(request),
      organizationId,
      agentId,
    );
  }

  private getUserId(request: AuthenticatedRequest): string {
    if (!request.user) {
      throw new UnauthorizedException("Authentication required");
    }

    return request.user.id;
  }
}
