import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/authenticated-request.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { ApprovalsService } from './approvals.service.js';

@Controller('v1/approvals')
@UseGuards(JwtAuthGuard)
export class ApprovalsController {
  constructor(private readonly approvals: ApprovalsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    return this.approvals.list(this.userId(request), query);
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  get(@Req() request: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.approvals.get(this.userId(request), id);
  }

  @Post(':id/decision')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  decide(@Req() request: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() body: unknown) {
    return this.approvals.decide(this.userId(request), id, body);
  }

  private userId(request: AuthenticatedRequest): string {
    if (!request.user) throw new UnauthorizedException('Authentication required');
    return request.user.id;
  }
}
