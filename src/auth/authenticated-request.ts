import type { FastifyRequest } from 'fastify';

export interface AuthenticatedUser {
  id: string;
}

export type AuthenticatedRequest = FastifyRequest & {
  user?: AuthenticatedUser;
};