import type { AuthenticatedAgent } from "../agent-credentials/agent-authentication.service.js";
import type { Prisma } from "../generated/prisma/client.js";

// A human can reconcile provider evidence, but is never an agent credential.
export interface OwnerReconciliation {
  readonly kind: "owner";
  readonly userId: string;
  readonly organizationId: string;
  readonly agentId: string;
}
export type ExecutionReader = AuthenticatedAgent | OwnerReconciliation;

export function executionScope(
  identity: ExecutionReader,
): Prisma.ExecutionWhereInput {
  return {
    organizationId: identity.organizationId,
    agentId: identity.agentId,
    ...("kind" in identity
      ? {
          agent: {
            organization: {
              members: { some: { userId: identity.userId, role: "OWNER" } },
            },
          },
        }
      : {}),
  };
}
