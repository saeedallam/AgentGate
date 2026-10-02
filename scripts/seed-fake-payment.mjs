import 'dotenv/config';
import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { PrismaService } from '../dist/infrastructure/database/prisma.service.js';
import { validateEnvironment } from '../dist/infrastructure/config/environment.js';

async function main() {
  const env = validateEnvironment(process.env);
  if (!env.FAKE_EXECUTION_ENABLED || env.NODE_ENV === 'production' || env.ACTION_ENVIRONMENT === 'production') {
    throw new Error('Enable the fake lab in a non-production environment first');
  }
  const [organizationId, paymentId = 'payment_demo', rawAmount = '10000'] = process.argv.slice(2);
  const data = z.strictObject({
    organizationId: z.uuid(), id: z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$(?![\s\S])/),
    amountMinor: z.coerce.number().int().positive().max(2147483647),
  }).parse({ organizationId, id: paymentId, amountMinor: rawAmount });
  const prisma = new PrismaService(new ConfigService(env));
  try {
    await prisma.fakePayment.create({ data });
    console.log('Created fake payment:', data.id);
  } finally { await prisma.$disconnect(); }
}
main().catch(() => { console.error('Could not seed payment. Check arguments, organization, configuration and duplicate IDs.'); process.exitCode = 1; });
