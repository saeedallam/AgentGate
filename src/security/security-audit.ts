import type { Prisma } from "../generated/prisma/client.js";
export function recordSecurityEvent(
  db: Pick<Prisma.TransactionClient, "securityAuditEvent">,
  organizationId: string,
  actorUserId: string,
  targetId: string,
  event:
    | "CONSOLE_SENSITIVE_READ"
    | "APPROVAL_SENSITIVE_READ"
    | "AGENT_SUSPENDED"
    | "AGENT_ACTIVATED"
    | "CREDENTIAL_REVOKED",
) {
  // Await before returning data or committing a control change. Failure is never swallowed.
  return db.securityAuditEvent.create({
    data: { organizationId, actorUserId, targetId, event },
  });
}
