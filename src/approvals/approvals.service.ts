import { recordSecurityEvent } from "../security/security-audit.js";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { z } from "zod";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../infrastructure/database/prisma.service.js";
import { verifiedActionRequest } from "../executions/verified-action-request.js";
import { transitionApproval } from "./approval-state.js";

const decisionSchema = z.strictObject({
  decision: z.enum(["APPROVED", "REJECTED"]),
});

const listSchema = z.strictObject({
  organizationId: z.uuid(),
  limit: z
    .string()
    .regex(/^[0-9]+$/)
    .transform(Number)
    .pipe(z.number().int().min(1).max(100))
    .default(50),
  offset: z
    .string()
    .regex(/^[0-9]+$/)
    .transform(Number)
    .pipe(z.number().int().min(0).max(10000))
    .default(0),
});

const summarySelect = {
  id: true,
  organizationId: true,
  executionId: true,
  status: true,
  createdAt: true,
  decidedAt: true,
  expiresAt: true,
  execution: { select: { actionName: true, status: true } },
} satisfies Prisma.ApprovalSelect;

type SummaryRow = Prisma.ApprovalGetPayload<{ select: typeof summarySelect }>;

// Deliberately allowlist fields; never spread database rows into monitoring responses.
function summary(row: SummaryRow) {
  return {
    id: row.id,
    executionId: row.executionId,
    status: row.status,
    actionName: row.execution.actionName,
    executionStatus: row.execution.status,
    createdAt: row.createdAt,
    decidedAt: row.decidedAt,
    expiresAt: row.expiresAt,
    expired: row.status === "PENDING" && row.expiresAt <= new Date(),
  };
}

@Injectable()
export class ApprovalsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(authenticatedUserId: string, input: unknown) {
    const parsed = listSchema.safeParse(input);
    if (!parsed.success)
      throw new BadRequestException("Invalid approval query");
    const { organizationId, limit, offset } = parsed.data;
    const membership = await this.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: { organizationId, userId: authenticatedUserId },
      },
      select: { role: true },
    });
    if (!membership) throw new NotFoundException("Organization not found");
    const rows = await this.prisma.approval.findMany({
      where: { organizationId },
      select: summarySelect,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
      skip: offset,
    });
    return { items: rows.map(summary), limit, offset };
  }

  async get(authenticatedUserId: string, approvalId: string) {
    if (!z.uuid().safeParse(approvalId).success)
      throw new BadRequestException("Invalid approval id");
    const approval = await this.prisma.approval.findUnique({
      where: { id: approvalId },
      select: { ...summarySelect, requestHash: true },
    });
    if (!approval) throw new NotFoundException("Approval not found");
    const membership = await this.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: approval.organizationId,
          userId: authenticatedUserId,
        },
      },
      select: { role: true },
    });
    if (!membership) throw new NotFoundException("Approval not found");
    const view = summary(approval);
    if (membership.role !== "OWNER") return view;
    const execution = await this.prisma.execution.findFirst({
      where: {
        id: approval.executionId,
        organizationId: approval.organizationId,
        agent: {
          organization: {
            members: { some: { userId: authenticatedUserId, role: "OWNER" } },
          },
        },
      },
    });
    if (!execution) throw new NotFoundException("Approval not found");
    const request = verifiedActionRequest(execution, approval.requestHash);
    await recordSecurityEvent(
      this.prisma,
      approval.organizationId,
      authenticatedUserId,
      approval.executionId,
      "APPROVAL_SENSITIVE_READ",
    );
    return { ...view, request };
  }

  async decide(
    authenticatedUserId: string,
    approvalId: string,
    input: unknown,
  ) {
    const body = decisionSchema.safeParse(input);
    if (!body.success || !z.uuid().safeParse(approvalId).success) {
      throw new BadRequestException("Invalid approval decision");
    }

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const approval = await tx.approval.findUnique({
            where: { id: approvalId },
          });
          if (!approval) throw new NotFoundException("Approval not found");

          const membership = await tx.organizationMember.findUnique({
            where: {
              organizationId_userId: {
                organizationId: approval.organizationId,
                userId: authenticatedUserId,
              },
            },
            select: { role: true },
          });
          if (!membership) throw new NotFoundException("Approval not found");
          if (membership.role !== "OWNER")
            throw new ForbiddenException("Owner role required");
          if (approval.expiresAt && approval.expiresAt <= new Date())
            throw new ConflictException("Approval expired");
          if (approval.status !== "PENDING")
            throw new ConflictException("Approval already decided");

          const execution = await tx.execution.findFirst({
            where: {
              id: approval.executionId,
              organizationId: approval.organizationId,
            },
          });
          if (
            !execution ||
            execution.status !== "RECEIVED" ||
            execution.policyDecision !== "REQUIRE_APPROVAL"
          ) {
            throw new ConflictException(
              "Execution is not awaiting an approval decision",
            );
          }
          verifiedActionRequest(execution, approval.requestHash);

          const status = transitionApproval(
            approval.status,
            body.data.decision,
          );
          const decidedAt = new Date();
          const changed = await tx.approval.updateMany({
            where: {
              id: approval.id,
              organizationId: approval.organizationId,
              status: "PENDING",
              expiresAt: { gt: new Date() },
            },
            data: { status, decidedByUserId: authenticatedUserId, decidedAt },
          });
          if (changed.count !== 1)
            throw new ConflictException("Approval already decided");

          return {
            id: approval.id,
            organizationId: approval.organizationId,
            executionId: approval.executionId,
            status,
            decidedByUserId: authenticatedUserId,
            decidedAt,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034"
      ) {
        throw new ConflictException(
          "Concurrent change detected; reload the approval",
        );
      }
      throw error;
    }
  }
}
