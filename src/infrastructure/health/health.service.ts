import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  async readiness(): Promise<{ status: 'ok' }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok' };
    } catch {
      throw new ServiceUnavailableException('Service not ready');
    }
  }
}
