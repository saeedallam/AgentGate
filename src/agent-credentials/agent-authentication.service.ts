import { Injectable, UnauthorizedException } from '@nestjs/common';

import { PrismaService } from '../infrastructure/database/prisma.service.js';
import { AgentKeyService } from './agent-key.service.js';

export interface AuthenticatedAgent {
  readonly agentId: string;
  readonly organizationId: string;
  readonly credentialId: string;
}

@Injectable()
export class AgentAuthenticationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly agentKeys: AgentKeyService
  ) {}

  async authenticate(apiKey: unknown): Promise<AuthenticatedAgent> {
    const keyPrefix = this.agentKeys.getPrefix(apiKey);

    if (keyPrefix === null) {
      throw new UnauthorizedException('Invalid agent credentials');
    }

    const credential = await this.prisma.agentCredential.findUnique({
      where: {
        keyPrefix,
      },
      select: {
        id: true,
        agentId: true,
        organizationId: true,
        keyHash: true,
        revokedAt: true,
        agent: {
          select: {
            status: true,
          },
        },
      },
    });

    if (!credential) {
      throw new UnauthorizedException('Invalid agent credentials');
    }

    const validKey = this.agentKeys.verify(apiKey, credential.keyHash);

    if (
      !validKey ||
      credential.revokedAt !== null ||
      credential.agent.status !== 'ACTIVE'
    ) {
      throw new UnauthorizedException('Invalid agent credentials');
    }

    return {
      agentId: credential.agentId,
      organizationId: credential.organizationId,
      credentialId: credential.id,
    };
  }
}
