import { ConfigService } from "@nestjs/config";
import { parseRefundBudgets } from "./refund-budget-config.js";
import {
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
  BadRequestException,
} from "@nestjs/common";
import { z } from "zod";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import type { AuthenticatedRequest } from "../auth/authenticated-request.js";
import { PrismaService } from "../infrastructure/database/prisma.service.js";
import { utcBudgetDay } from "./refund-budget-config.js";

const querySchema = z.strictObject({
  environment: z
    .enum(["development", "staging", "production"])
    .default("development"),
  day: z.iso.date().optional(),
});

@Controller("v1/organizations/:organizationId/refund-budgets")
@UseGuards(JwtAuthGuard)
export class RefundBudgetsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  @Header("Cache-Control", "no-store")
  async read(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", new ParseUUIDPipe({ version: "4" }))
    organizationId: string,
    @Query() query: unknown,
  ) {
    if (!request.user)
      throw new UnauthorizedException("Authentication required");
    const member = await this.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: { organizationId, userId: request.user.id },
      },
      select: { role: true },
    });
    if (!member) throw new NotFoundException("Refund budget not found");
    const parsed = querySchema.safeParse(query);
    if (!parsed.success)
      throw new BadRequestException("Invalid refund budget query");
    const day = parsed.data.day
      ? new Date(parsed.data.day + "T00:00:00.000Z")
      : utcBudgetDay(new Date());
    const bucket = await this.prisma.refundBudgetBucket.findUnique({
      where: {
        organizationId_environment_currency_day: {
          organizationId,
          environment: parsed.data.environment,
          currency: "USD",
          day,
        },
      },
    });
    if (!bucket)
      throw new NotFoundException(
        "No refund budget bucket has been opened for this day",
      );
    const configured = parseRefundBudgets(
      this.config.getOrThrow<string>("REFUND_BUDGETS_JSON"),
    ).find(
      (r) =>
        r.organizationId === organizationId &&
        r.environment === bucket.environment &&
        r.currency === bucket.currency,
    );
    const nextDay = new Date(utcBudgetDay(new Date()).getTime() + 86400000);
    return {
      ...bucket,
      nextDayLimitMinor: configured?.limitMinor ?? null,
      nextDayStartsAt: nextDay,
      availableMinor:
        bucket.limitMinor - bucket.reservedMinor - bucket.consumedMinor,
      timezone: "UTC",
    };
  }
}
