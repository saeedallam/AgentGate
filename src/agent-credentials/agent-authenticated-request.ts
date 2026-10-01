import type { FastifyRequest } from 'fastify';

import type { AuthenticatedAgent } from './agent-authentication.service.js';

export type AgentAuthenticatedRequest = FastifyRequest & {
  agent?: AuthenticatedAgent;
};
