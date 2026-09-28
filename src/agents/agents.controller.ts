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
} from '@nestjs/common';

import type { AuthenticatedRequest } from '../auth/authenticated-request.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { AgentsService } from './agents.service.js';

@Controller('agents')
@UseGuards(JwtAuthGuard)
export class AgentsController {
  constructor(private readonly agents: AgentsService) {}

  @Post()
  create(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.agents.createForUser(this.getUserId(request), body);
  }

  @Get()
  list(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    return this.agents.listForUser(this.getUserId(request), query);
  }

  @Get(':id')
  get(
    @Req() request: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' }))
    agentId: string,
    @Query('organizationId', new ParseUUIDPipe({ version: '4' }))
    organizationId: string
  ) {
    return this.agents.getForUser(
      this.getUserId(request),
      organizationId,
      agentId
    );
  }

  private getUserId(request: AuthenticatedRequest): string {
    if (!request.user) {
      throw new UnauthorizedException('Authentication required');
    }

    return request.user.id;
  }
}
