import { ConflictException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { ActionRequest } from "../actions/action-request.js";
import { PrismaService } from "../infrastructure/database/prisma.service.js";
import type { PolicyDecision } from "../policies/policy.js";
import { actionJson } from "./action-json.js";

// Owns whole transactions; never dispatches a provider.
export class ExecutionReceipts {
  constructor(private readonly prisma: PrismaService) {}
  async receive(
    request: ActionRequest,
    idempotencyKey: string,
    evaluate: () => {
      policyDecision: PolicyDecision;
      policyReason: string;
      policyHash: string;
      policyHashVersion?: number;
      policyEvaluatedAt: Date;
    },
  ) {
    const { args, hash } = actionJson(request);
    const scope = {
      organizationId: request.organizationId,
      agentId: request.principal.id,
    };
    const lookup = () =>
      this.prisma.execution.findFirst({
        where: { ...scope, idempotencyKey },
        include: { approval: true },
      });
    const verify = (
      existing: NonNullable<Awaited<ReturnType<typeof lookup>>>,
    ) => {
      if (existing.requestHash !== hash)
        throw new ConflictException(
          "Idempotency key already used for a different action",
        );
      return existing;
    };
    const existing = await lookup();
    if (existing) return verify(existing);
    // Evaluate only new requests. A unique constraint selects the winner if requests race.
    const decision = evaluate();
    return this.prisma.$transaction(async (tx) => {
      const id = randomUUID();
      const inserted = await tx.execution.createMany({
        skipDuplicates: true,
        data: [
          {
            id,
            ...scope,
            idempotencyKey,
            requestHash: hash,
            recoveryVersion: 1,
            ...decision,
            actionName: request.action.name,
            arguments: args,
            resourceType: request.resource?.type ?? null,
            resourceId: request.resource?.id ?? null,
            environment: request.context.environment,
            requestedAt: request.context.requestedAt,
          },
        ],
      });
      if (inserted.count === 0) {
        return verify(
          await tx.execution.findFirstOrThrow({
            where: { ...scope, idempotencyKey },
            include: { approval: true },
          }),
        );
      }
      if (decision.policyDecision === "REQUIRE_APPROVAL") {
        await tx.approval.create({
          data: {
            organizationId: scope.organizationId,
            executionId: id,
            requestHash: hash,
          },
        });
      }
      return tx.execution.findUniqueOrThrow({
        where: { id },
        include: { approval: true },
      });
    });
  }
}
