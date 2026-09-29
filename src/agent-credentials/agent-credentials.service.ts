import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';

import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../infrastructure/database/prisma.service.js';
import { AgentKeyService } from './agent-key.service.js';

const credentialTargetSchema = z.strictObject({
  organizationId: z.uuid(),
  agentId: z.uuid(),
});

@Injectable()
export class AgentCredentialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly agentKeys: AgentKeyService
  ) {}

  async createForUser(authenticatedUserId: string, input: unknown) {
    const result = credentialTargetSchema.safeParse(input);

    if (!result.success) {
      throw new BadRequestException('Invalid credential target');
    }

    const { organizationId, agentId } = result.data;

    try {
      return await this.prisma.$transaction(
        async (transaction) => {
          const membership = await transaction.organizationMember.findUnique({
            where: {
              organizationId_userId: {
                organizationId,
                userId: authenticatedUserId,
              },
            },
            select: {
              role: true,
            },
          });

          if (!membership) {
            throw new NotFoundException('Organization not found');
          }

          if (membership.role !== 'OWNER') {
            throw new ForbiddenException('Owner role required');
          }

          const agent = await transaction.agent.findFirst({
            where: {
              id: agentId,
              organizationId,
            },
            select: {
              id: true,
              status: true,
            },
          });

          if (!agent) {
            throw new NotFoundException('Agent not found');
          }

          if (agent.status !== 'ACTIVE') {
            throw new ConflictException('Agent is suspended');
          }

          const generated = this.agentKeys.generate();

          const credential = await transaction.agentCredential.create({
            data: {
              organizationId,
              agentId: agent.id,
              keyPrefix: generated.keyPrefix,
              keyHash: generated.keyHash,
            },
            select: {
              id: true,
              organizationId: true,
              agentId: true,
              keyPrefix: true,
              createdAt: true,
            },
          });

          return {
            ...credential,
            apiKey: generated.apiKey,
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        }
      );
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2034') {
          throw new ConflictException(
            'Concurrent change detected; retry the request'
          );
        }

        if (error.code === 'P2002') {
          throw new ConflictException(
            'Credential identifier collision; retry the request'
          );
        }
      }

      throw error;
    }
  }
}
