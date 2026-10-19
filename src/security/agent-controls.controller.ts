import { ApiInput, ApiErrors } from "../openapi/api-contract.js";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import {
  BadRequestException,
  Body,
  Controller,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import type { AuthenticatedRequest } from "../auth/authenticated-request.js";
import { PrismaService } from "../infrastructure/database/prisma.service.js";
import { recordSecurityEvent } from "./security-audit.js";

@ApiTags("security")
@Controller("v1/organizations/:organizationId/agents/:agentId")
@UseGuards(JwtAuthGuard)
@ApiBearerAuth("userJwt")
export class AgentControlsController {
  constructor(private readonly prisma: PrismaService) {}
  @ApiErrors("OWNER activates or suspends an agent; claimed work may finish")
  @ApiInput(z.strictObject({ status: z.enum(["ACTIVE", "SUSPENDED"]) }))
  @Post("status")
  async status(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", new ParseUUIDPipe()) organizationId: string,
    @Param("agentId", new ParseUUIDPipe()) agentId: string,
    @Body() input: unknown,
  ) {
    if (!request.user) throw new UnauthorizedException();
    const parsed = z
      .strictObject({ status: z.enum(["ACTIVE", "SUSPENDED"]) })
      .safeParse(input);
    if (!parsed.success) throw new BadRequestException("Invalid agent status");
    const userId = request.user.id;
    return this.prisma.$transaction(async (tx) => {
      await this.lockOwner(tx, userId, organizationId, agentId);
      const agent = await tx.agent.update({
        where: { id: agentId },
        data: { status: parsed.data.status },
        select: { id: true, organizationId: true, status: true },
      });
      await recordSecurityEvent(
        tx,
        organizationId,
        userId,
        agentId,
        agent.status === "ACTIVE" ? "AGENT_ACTIVATED" : "AGENT_SUSPENDED",
      );
      return agent;
    });
  }
  @ApiErrors("OWNER revokes an agent credential")
  @ApiInput(z.strictObject({}), {})
  @Post("credentials/:credentialId/revoke")
  async revoke(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", new ParseUUIDPipe()) organizationId: string,
    @Param("agentId", new ParseUUIDPipe()) agentId: string,
    @Param("credentialId", new ParseUUIDPipe()) credentialId: string,
    @Body() input: unknown,
  ) {
    if (!request.user) throw new UnauthorizedException();
    if (!z.strictObject({}).safeParse(input ?? {}).success)
      throw new BadRequestException("Revoke accepts no payload");
    const userId = request.user.id;
    return this.prisma.$transaction(async (tx) => {
      await this.lockOwner(tx, userId, organizationId, agentId);
      const credential = await tx.agentCredential.findFirst({
        where: { id: credentialId, organizationId, agentId },
        select: { id: true, revokedAt: true },
      });
      if (!credential) throw new NotFoundException("Credential not found");
      if (!credential.revokedAt) {
        credential.revokedAt = new Date();
        await tx.agentCredential.update({
          where: { id: credentialId },
          data: { revokedAt: credential.revokedAt },
        });
        await recordSecurityEvent(
          tx,
          organizationId,
          userId,
          credentialId,
          "CREDENTIAL_REVOKED",
        );
      }
      return credential;
    });
  }
  private async lockOwner(
    tx: import("../generated/prisma/client.js").Prisma.TransactionClient,
    userId: string,
    organizationId: string,
    agentId: string,
  ) {
    const owners = await tx.$queryRaw<
      { userId: string }[]
    >`SELECT "userId" FROM "OrganizationMember" WHERE "organizationId" = ${organizationId}::uuid AND "userId" = ${userId}::uuid AND role = 'OWNER' FOR SHARE`;
    if (!owners.length) throw new NotFoundException("Agent not found");
    const agents = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM "Agent" WHERE id = ${agentId}::uuid AND "organizationId" = ${organizationId}::uuid FOR UPDATE`;
    if (!agents.length) throw new NotFoundException("Agent not found");
  }
}
