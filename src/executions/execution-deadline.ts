import { ConflictException } from "@nestjs/common";
export function assertUnexpired(
  execution: { status: string; expiresAt?: Date },
  now = new Date(),
) {
  if (
    execution.status === "RECEIVED" &&
    execution.expiresAt &&
    execution.expiresAt <= now
  ) {
    throw new ConflictException({
      statusCode: 409,
      error: "Conflict",
      code: "EXECUTION_EXPIRED",
      message:
        "Request expired before execution; create a new explicitly authorized intent",
    });
  }
}
