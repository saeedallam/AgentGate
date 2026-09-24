import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';

import type { AuthenticatedRequest } from '../auth/authenticated-request.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { createOrganizationSchema } from './dto/create-organization.dto.js';
import { OrganizationsService } from './organizations.service.js';

@Controller('organizations')
@UseGuards(JwtAuthGuard)
export class OrganizationsController {
  constructor(
    private readonly organizations: OrganizationsService,
  ) {}

  @Post()
  create(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
  ) {
    const userId = this.getUserId(request);
    const result = createOrganizationSchema.safeParse(body);

    if (!result.success) {
      throw new BadRequestException('Invalid organization data');
    }

    return this.organizations.createForUser(
      userId,
      result.data.name,
    );
  }

  @Get(':id')
  get(
    @Req() request: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' }))
    organizationId: string,
  ) {
    return this.organizations.getForUser(
      this.getUserId(request),
      organizationId,
    );
  }

  private getUserId(request: AuthenticatedRequest): string {
    if (!request.user) {
      throw new UnauthorizedException('Authentication required');
    }

    return request.user.id;
  }
}