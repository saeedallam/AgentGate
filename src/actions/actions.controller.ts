import { ApiExecutionResponse } from "../openapi/api-responses.js";
import { ApiInput, ApiErrors } from "../openapi/api-contract.js";
import { ApiHeader } from "@nestjs/swagger";
import { refundSubmissionSchema } from "../openapi/refund-submission.js";
import { z } from "zod";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { ActionRateGuard } from "../security/action-rate.guard.js";
import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { AgentAuthGuard } from "../agent-credentials/agent-auth.guard.js";
import type { AgentAuthenticatedRequest } from "../agent-credentials/agent-authenticated-request.js";
import { ExecutionsService } from "../executions/executions.service.js";
import { ActionsService } from "./actions.service.js";

@ApiTags("actions")
@Controller("v1")
@UseGuards(AgentAuthGuard)
@ApiBearerAuth("agentApiKey")
export class ActionsController {
  constructor(
    private readonly actions: ActionsService,
    private readonly executions: ExecutionsService,
  ) {}

  @ApiErrors("Submit an action; replay the same intent with the same key")
  @ApiInput(refundSubmissionSchema, {
    action: { name: "refund.create" },
    arguments: {
      paymentId: "payment_demo",
      amountMinor: 5000,
      currency: "USD",
    },
  })
  @ApiHeader({
    name: "Idempotency-Key",
    required: true,
    description:
      "Persist one key per intent. Reuse with identical payload after a lost reply; a changed payload conflicts. Never generate a new key merely to retry.",
    schema: {
      type: "string",
      minLength: 1,
      maxLength: 128,
      pattern: "^[A-Za-z0-9_-]+$",
    },
    example: "demo-refund-001",
  })
  @Post("actions")
  @UseGuards(ActionRateGuard)
  @ApiExecutionResponse()
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  submit(
    @Req() request: AgentAuthenticatedRequest,
    @Body() body: unknown,
    @Headers("idempotency-key") key: unknown,
  ) {
    if (!request.agent)
      throw new UnauthorizedException("Authentication required");
    return this.actions.submit(request.agent, body, key);
  }

  @ApiErrors("Resume the exact stored action after approval")
  @ApiInput(z.strictObject({}), {})
  @Post("executions/:id/resume")
  @UseGuards(ActionRateGuard)
  @ApiExecutionResponse()
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  resume(
    @Req() request: AgentAuthenticatedRequest,
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Body() body: unknown,
  ) {
    if (!request.agent)
      throw new UnauthorizedException("Authentication required");
    return this.actions.resume(request.agent, id, body);
  }

  @ApiErrors("Look up the existing provider outcome without dispatching")
  @ApiInput(z.strictObject({}), {})
  @Post("executions/:id/reconcile")
  @UseGuards(ActionRateGuard)
  @ApiExecutionResponse()
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  reconcile(
    @Req() request: AgentAuthenticatedRequest,
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Body() body: unknown,
  ) {
    if (!request.agent)
      throw new UnauthorizedException("Authentication required");
    return this.actions.reconcile(request.agent, id, body);
  }

  @ApiErrors("Explicit safe retry subject to lease, backoff and attempt limits")
  @ApiInput(z.strictObject({}), {})
  @Post("executions/:id/retry")
  @UseGuards(ActionRateGuard)
  @ApiExecutionResponse()
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  retry(
    @Req() request: AgentAuthenticatedRequest,
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Body() body: unknown,
  ) {
    if (!request.agent)
      throw new UnauthorizedException("Authentication required");
    return this.actions.retry(request.agent, id, body);
  }

  @ApiExecutionResponse()
  @Get("executions/:id")
  @Header("Cache-Control", "no-store")
  get(
    @Req() request: AgentAuthenticatedRequest,
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
  ) {
    if (!request.agent)
      throw new UnauthorizedException("Authentication required");
    return this.executions.get(request.agent, id);
  }
}
