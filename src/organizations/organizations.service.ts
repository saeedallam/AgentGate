import { BadRequestException, Injectable } from '@nestjs/common';
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
}