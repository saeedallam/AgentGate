import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { z } from "zod";
import type { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../infrastructure/database/prisma.service.js";

const pageSchema = z.strictObject({
  cursor: z.uuid().optional(),
  status: z
    .enum([
      "RECEIVED",
      "EXECUTING",
      "SUCCEEDED",
      "FAILED",
      "OUTCOME_UNKNOWN",
      "DENIED",
    ])
    .optional(),
});
const executionSummary = {
  id: true,
  agentId: true,
  actionName: true,
  status: true,
  environment: true,
  createdAt: true,
  updatedAt: true,
  policyDecision: true,
  errorCode: true,
  attemptCount: true,
  agent: { select: { name: true } },
  approval: { select: { id: true, status: true } },
} satisfies Prisma.ExecutionSelect;

@Injectable()
export class ConsoleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async workspaces(userId: string) {
    const rows = await this.prisma.organizationMember.findMany({
      where: { userId },
      take: 101,
      orderBy: [{ createdAt: "asc" }, { organizationId: "asc" }],
      select: {
        role: true,
        organization: { select: { id: true, name: true } },
      },
    });
    return {
      items: rows
        .slice(0, 100)
        .map((row) => ({ ...row.organization, role: row.role })),
      hasMore: rows.length > 100,
    };
  }

  private async membership(userId: string, organizationId: string) {
    const member = await this.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: { role: true },
    });
    if (!member) throw new NotFoundException("Workspace not found");
    return member;
  }

  private scope(
    userId: string,
    organizationId: string,
  ): Prisma.ExecutionWhereInput {
    return {
      organizationId,
      agent: { organization: { members: { some: { userId } } } },
    };
  }

  async overview(userId: string, organizationId: string) {
    await this.membership(userId, organizationId);
    const scope = this.scope(userId, organizationId);
    const [states, agents, activeAgents, pendingApprovals, recent] =
      await Promise.all([
        this.prisma.execution.groupBy({
          by: ["status"],
          where: scope,
          _count: { _all: true },
        }),
        this.prisma.agent.count({
          where: {
            organizationId,
            organization: { members: { some: { userId } } },
          },
        }),
        this.prisma.agent.count({
          where: {
            organizationId,
            status: "ACTIVE",
            organization: { members: { some: { userId } } },
          },
        }),
        this.prisma.approval.count({
          where: { organizationId, status: "PENDING", execution: scope },
        }),
        this.prisma.execution.findMany({
          where: scope,
          take: 8,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: executionSummary,
        }),
      ]);
    const counts = Object.fromEntries(
      states.map((row) => [row.status, row._count._all]),
    );
    return {
      agents,
      activeAgents,
      pendingApprovals,
      counts,
      totalExecutions: states.reduce((sum, row) => sum + row._count._all, 0),
      recent,
      environment: this.config.get<string>("ACTION_ENVIRONMENT", "development"),
      fakeExecutionEnabled: this.config.get<boolean>(
        "FAKE_EXECUTION_ENABLED",
        false,
      ),
    };
  }

  async executions(userId: string, organizationId: string, input: unknown) {
    await this.membership(userId, organizationId);
    const parsed = pageSchema.safeParse(input);
    if (!parsed.success)
      throw new BadRequestException("Invalid execution query");
    const where: Prisma.ExecutionWhereInput = {
      ...this.scope(userId, organizationId),
      ...(parsed.data.status ? { status: parsed.data.status } : {}),
    };
    if (parsed.data.cursor) {
      const cursor = await this.prisma.execution.findFirst({
        where: { ...where, id: parsed.data.cursor },
        select: { id: true, createdAt: true },
      });
      if (!cursor) throw new NotFoundException("Execution cursor not found");
      where.OR = [
        { createdAt: { lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, id: { lt: cursor.id } },
      ];
    }
    const rows = await this.prisma.execution.findMany({
      where,
      select: executionSummary,
      take: 26,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    const items = rows.slice(0, 25);
    return { items, nextCursor: rows.length > 25 ? items.at(-1)?.id : null };
  }

  async execution(userId: string, organizationId: string, id: string) {
    const member = await this.membership(userId, organizationId);
    const owner = member.role === "OWNER";
    const row = await this.prisma.execution.findFirst({
      where: {
        ...this.scope(userId, organizationId), id,
        ...(owner ? { agent: { organization: { members: { some: { userId, role: 'OWNER' as const } } } } } : {}),
      },
      select: {
        ...executionSummary,
        requestedAt: true,
        policyReason: true,
        policyEvaluatedAt: true,
        blockedPolicyDecision: true,
        blockedAt: true,
        leaseExpiresAt: true,
        nextRetryAt: true,
        attempts: {
          orderBy: { attemptNumber: "asc" },
          select: {
            id: true,
            attemptNumber: true,
            status: true,
            startedAt: true,
            finishedAt: true,
            errorCode: true,
            resolvedAt: true,
            resolvedStatus: true,
          },
        },
        ...(owner
          ? {
              arguments: true,
              result: true,
              resourceType: true,
              resourceId: true,
              requestHash: true,
              policyHash: true,
            }
          : {}),
      },
    });
    if (!row) throw new NotFoundException("Execution not found");
    return row;
  }
}
