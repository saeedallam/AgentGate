import { ApiTags } from "@nestjs/swagger";
import { Controller, Get } from "@nestjs/common";
import { HealthService } from "./health.service.js";

@ApiTags("health")
@Controller("health")
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  liveness(): { status: "ok" } {
    return { status: "ok" };
  }

  @Get("ready")
  readiness(): Promise<{ status: "ok" }> {
    return this.health.readiness();
  }
}
