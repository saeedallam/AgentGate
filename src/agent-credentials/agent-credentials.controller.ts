import {
  BadRequestException,
  Body,
  Controller,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';

import type { AuthenticatedRequest } from '../auth/authenticated-request.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { AgentCredentialsService } from './agent-credentials.service.js';

const createCredentialBodySchema = z.strictObject({
  organizationId: z.uuid(),
});

@Controller('agents/:id/credentials')
@UseGuards(JwtAuthGuard)
export class AgentCredentialsController {
  constructor(private readonly credentials: AgentCredentialsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', 'no-store')
  create(
    @Req() request: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' }))
    agentId: string,
    @Body() body: unknown
  ) {
    if (!request.user) {
      throw new UnauthorizedException('Authentication required');
    }

    const result = createCredentialBodySchema.safeParse(body);

    if (!result.success) {
      throw new BadRequestException('Invalid credential request');
    }

    return this.credentials.createForUser(request.user.id, {
      organizationId: result.data.organizationId,
      agentId,
    });
  }
}
