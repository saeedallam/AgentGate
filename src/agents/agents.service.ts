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
import { listAgentsSchema } from './dto/list-agents.dto.js';

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
        }
      );
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new ConflictException(
            'Agent name already exists in this organization'
          );
        }

        if (error.code === 'P2034') {
          throw new ConflictException(
            'Concurrent change detected; retry the request'
          );
        }
      }

      throw error;
    }
  }

  async getForUser(
    authenticatedUserId: string,
    organizationId: string,
    agentId: string
  ) {
    const agent = await this.prisma.agent.findFirst({
      where: {
        id: agentId,
        organizationId,
        organization: {
          members: {
            some: {
              userId: authenticatedUserId,
            },
          },
        },
      },
      select: {
        id: true,
        organizationId: true,
        name: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!agent) {
      throw new NotFoundException('Agent not found');
    }

    return agent;
  }

  async listForUser(authenticatedUserId: string, input: unknown) {
    const result = listAgentsSchema.safeParse(input);

    if (!result.success) {
      throw new BadRequestException('Invalid agent list query');
    }

    const { organizationId, limit, offset } = result.data;

    const organization = await this.prisma.organization.findFirst({
      where: {
        id: organizationId,
        members: {
          some: {
            userId: authenticatedUserId,
          },
        },
      },
      select: {
        agents: {
          // Keep the membership requirement on the returned rows too.
          where: {
            organizationId,
            organization: {
              members: {
                some: {
                  userId: authenticatedUserId,
                },
              },
            },
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: offset,
          take: limit + 1,
          select: {
            id: true,
            organizationId: true,
            name: true,
            status: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });

    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    const hasMore = organization.agents.length > limit;

    return {
      items: organization.agents.slice(0, limit),
      limit,
      offset,
      hasMore,
    };
  }
}
