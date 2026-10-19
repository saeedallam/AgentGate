import { ApiInput, ApiQueryInput, ApiErrors } from "../openapi/api-contract.js";
import { simulationSchema, listSchema } from "./observations.service.js";
import { refundSubmissionSchema } from "../openapi/refund-submission.js";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
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

@ApiTags("observations")
@Controller("v1/actions")
@UseGuards(AgentAuthGuard, ActionRateGuard)
@ApiBearerAuth("agentApiKey")
export class ActionObservationsController {
  constructor(private readonly observations: ObservationsService) {}
  @ApiErrors("Observe a policy decision without executing an action")
  @ApiInput(refundSubmissionSchema)
  @Post("observe")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  observe(@Req() request: AgentAuthenticatedRequest, @Body() input: unknown) {
    if (!request.agent)
      throw new UnauthorizedException("Authentication required");
    return this.observations.observe(request.agent, input);
  }
}

@ApiTags("observations")
@Controller("v1/organizations/:organizationId")
@UseGuards(JwtAuthGuard)
@ApiBearerAuth("userJwt")
export class PolicyStudiesController {
  constructor(private readonly observations: ObservationsService) {}
  @ApiErrors("OWNER simulates candidate rules against bounded stored history")
  @ApiInput(simulationSchema)
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
  @ApiQueryInput(listSchema)
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
