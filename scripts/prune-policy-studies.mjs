import 'dotenv/config';
import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../dist/infrastructure/database/prisma.service.js';

async function main() {
  const db = new PrismaService(new ConfigService({ DATABASE_URL: process.env.DATABASE_URL }));
  try {
    // One bounded batch per invocation. Schedule this with the operator's normal job runner.
    const rows = await db.policyStudy.findMany({ where: { expiresAt: { lte: new Date() } }, take: 1000, select: { id: true }, orderBy: { expiresAt: 'asc' } });
    const deleted = await db.policyStudy.deleteMany({ where: { id: { in: rows.map(row => row.id) }, expiresAt: { lte: new Date() } } });
    console.log(`Deleted ${deleted.count} expired policy studies.`);
  } finally { await db.$disconnect(); }
}
main().catch(() => { console.error('Policy-study cleanup failed; check database configuration.'); process.exitCode = 1; });
