import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';

import { PrismaService } from '../infrastructure/database/prisma.service.js';

const organizationNameSchema = z.string().trim().min(1).max(120);

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  async createForUser(authenticatedUserId: string, name: string) {
    const result = organizationNameSchema.safeParse(name);

    if (!result.success) {
      throw new BadRequestException('Invalid organization name');
    }

    return this.prisma.organization.create({
      data: {
        name: result.data,

        members: {
          create: {
            userId: authenticatedUserId,
            role: 'OWNER',
          },
        },
      },

      select: {
        id: true,
        name: true,
        createdAt: true,
      },
    });
  }
async getForUser(authenticatedUserId: string, organizationId: string) {
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
      id: true,
      name: true,
      createdAt: true,
    },
  });

  if (!organization) {
    throw new NotFoundException('Organization not found');
  }

  return organization;
}

}


