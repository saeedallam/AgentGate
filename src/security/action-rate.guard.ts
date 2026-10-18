import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { PrismaService } from "../infrastructure/database/prisma.service.js";
import type { AgentAuthenticatedRequest } from "../agent-credentials/agent-authenticated-request.js";

// Two shared fixed windows. Atomic UPSERT caps concurrent callers on every instance.
@Injectable()
export class ActionRateGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}
  async canActivate(context: ExecutionContext) {
    const request = context
      .switchToHttp()
      .getRequest<AgentAuthenticatedRequest>();
    if (!request.agent) throw new UnauthorizedException();
    const kind =
      context.getHandler().name === "observe" ? "observe" : "actions";
    const { organizationId, agentId } = request.agent;
    // Check organization first, consistently, to avoid cross-agent lock inversions.
    for (const [key, limit] of [
      [`${kind}:org:${organizationId}`, 300],
      [`${kind}:agent:${organizationId}:${agentId}`, 60],
    ] as const) {
      const rows = await this.prisma.$queryRaw<{ count: number }[]>`
        INSERT INTO "RequestRateWindow" (key, "windowStart", count)
        VALUES (${key}, date_trunc('minute', clock_timestamp()), 1)
        ON CONFLICT (key) DO UPDATE SET
          "windowStart" = date_trunc('minute', clock_timestamp()),
          count = CASE WHEN "RequestRateWindow"."windowStart" < date_trunc('minute', clock_timestamp()) THEN 1 ELSE "RequestRateWindow".count + 1 END
        WHERE "RequestRateWindow"."windowStart" < date_trunc('minute', clock_timestamp()) OR "RequestRateWindow".count < ${limit}
        RETURNING count`;
      if (!rows.length) {
        context
          .switchToHttp()
          .getResponse<{ header: (key: string, value: string) => void }>()
          .header("Retry-After", "60");
        throw new HttpException(
          {
            statusCode: 429,
            error: "Too Many Requests",
            code: "ACTION_RATE_LIMITED",
            message:
              "Request rate limit exceeded; preserve the original operation key",
          },
          429,
        );
      }
    }
    return true;
  }
}
