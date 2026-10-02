import { Body, Controller, Get, Header, Headers, HttpCode, Param, ParseUUIDPipe, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { AgentAuthGuard } from '../agent-credentials/agent-auth.guard.js';
import type { AgentAuthenticatedRequest } from '../agent-credentials/agent-authenticated-request.js';
import { ExecutionsService } from '../executions/executions.service.js';
import { ActionsService } from './actions.service.js';

@Controller('v1')
@UseGuards(AgentAuthGuard)
export class ActionsController {
  constructor(private readonly actions: ActionsService, private readonly executions: ExecutionsService) {}

  @Post('actions')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  submit(@Req() request: AgentAuthenticatedRequest, @Body() body: unknown,
    @Headers('idempotency-key') key: unknown) {
    if (!request.agent) throw new UnauthorizedException('Authentication required');
    return this.actions.submit(request.agent, body, key);
  }

  @Get('executions/:id')
  @Header('Cache-Control', 'no-store')
  get(@Req() request: AgentAuthenticatedRequest, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    if (!request.agent) throw new UnauthorizedException('Authentication required');
    return this.executions.get(request.agent, id);
  }
}
