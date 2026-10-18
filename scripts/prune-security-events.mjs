import "dotenv/config";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../dist/infrastructure/database/prisma.service.js";
const db = new PrismaService(
  new ConfigService({ DATABASE_URL: process.env.DATABASE_URL }),
);
try {
  const cutoff = new Date(Date.now() - 90 * 86400000);
  const rows = await db.securityAuditEvent.findMany({
    where: { createdAt: { lt: cutoff } },
    select: { id: true },
    take: 1000,
    orderBy: { createdAt: "asc" },
  });
  const deleted = await db.securityAuditEvent.deleteMany({
    where: { id: { in: rows.map((row) => row.id) }, createdAt: { lt: cutoff } },
  });
  const windows = await db.requestRateWindow.findMany({
    where: { windowStart: { lt: cutoff } },
    select: { key: true },
    take: 1000,
  });
  await db.requestRateWindow.deleteMany({
    where: {
      key: { in: windows.map((row) => row.key) },
      windowStart: { lt: cutoff },
    },
  });
  console.log(
    `Removed ${deleted.count} expired security events (90-day retention; maximum 1000 per run).`,
  );
} finally {
  await db.$disconnect();
}
