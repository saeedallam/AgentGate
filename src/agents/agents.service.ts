import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../infrastructure/database/prisma.service.js';
import { createAgentSchema } from './dto/create-agent.dto.js';

@Injectable()
export class AgentsService {
  constructor(private readonly prisma: PrismaService) {}

  async createForUser(authenticatedUserId: string, input: unknown) {
    const result = createAgentSchema.safeParse(input);

    if (!result.success) {
      throw new BadRequestException('Invalid agent data');
    }

    const { organizationId, name } = result.data;

    try {
      return await this.prisma.$transaction(
        async (transaction) => {
          const membership =
            await transaction.organizationMember.findUnique({
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

          return transaction.agent.create({
            data: {
              organizationId,
              name,
            },
            select: {
              id: true,
              organizationId: true,
              name: true,
              status: true,
              createdAt: true,
            },
          });
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        },
      );
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new ConflictException(
            'Agent name already exists in this organization',
          );
        }

        if (error.code === 'P2034') {
          throw new ConflictException(
            'Concurrent change detected; retry the request',
          );
        }
      }

      throw error;
    }
  }
}