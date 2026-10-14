import { Body, Controller, ForbiddenException, Header, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { AuthenticatedRequest } from '../auth/authenticated-request.js';
import { PrismaService } from '../infrastructure/database/prisma.service.js';
import { ActionsService } from './actions.service.js';

// Read provider evidence even after the agent/key is disabled. No retry here.
@Controller('v1/organizations/:organizationId/executions')
@UseGuards(JwtAuthGuard)
export class RecoveryMonitoringController {
  constructor(private readonly prisma: PrismaService, private readonly actions: ActionsService) {}

  @Post(':id/reconcile')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async reconcile(@Req() request: AuthenticatedRequest,
    @Param('organizationId', new ParseUUIDPipe({ version: '4' })) organizationId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() body: unknown) {
    if (!request.user) throw new UnauthorizedException('Authentication required');
    const membership = await this.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId: request.user.id } }, select: { role: true },
    });
    if (!membership) throw new NotFoundException('Execution not found');
    if (membership.role !== 'OWNER') throw new ForbiddenException('Owner role required');
    const execution = await this.prisma.execution.findFirst({ where: { id, organizationId }, select: { agentId: true } });
    if (!execution) throw new NotFoundException('Execution not found');
    return this.actions.reconcile({ organizationId, agentId: execution.agentId, credentialId: '' }, id, body);
  }
}
