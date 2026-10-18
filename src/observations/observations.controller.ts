import { ActionRateGuard } from "../security/action-rate.guard.js";
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { AgentAuthGuard } from "../agent-credentials/agent-auth.guard.js";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import type { AgentAuthenticatedRequest } from "../agent-credentials/agent-authenticated-request.js";
import type { AuthenticatedRequest } from "../auth/authenticated-request.js";
import { ObservationsService } from "./observations.service.js";

@Controller("v1/actions")
@UseGuards(AgentAuthGuard, ActionRateGuard)
export class ActionObservationsController {
  constructor(private readonly observations: ObservationsService) {}
  @Post("observe")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  observe(@Req() request: AgentAuthenticatedRequest, @Body() input: unknown) {
    if (!request.agent)
      throw new UnauthorizedException("Authentication required");
    return this.observations.observe(request.agent, input);
  }
}

@Controller("v1/organizations/:organizationId")
@UseGuards(JwtAuthGuard)
export class PolicyStudiesController {
  constructor(private readonly observations: ObservationsService) {}
  @Post("policy-simulations")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  simulate(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", new ParseUUIDPipe()) org: string,
    @Body() input: unknown,
  ) {
    if (!request.user)
      throw new UnauthorizedException("Authentication required");
    return this.observations.simulate(request.user.id, org, input);
  }
  @Get("policy-observations")
  @Header("Cache-Control", "no-store")
  list(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", new ParseUUIDPipe()) org: string,
    @Query() query: unknown,
  ) {
    if (!request.user)
      throw new UnauthorizedException("Authentication required");
    return this.observations.list(request.user.id, org, query);
  }
  @Get("policy-observations/:id")
  @Header("Cache-Control", "no-store")
  get(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", new ParseUUIDPipe()) org: string,
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    if (!request.user)
      throw new UnauthorizedException("Authentication required");
    return this.observations.get(request.user.id, org, id);
  }
}
