import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { Prisma, Execution } from '../generated/prisma/client.js';
import { parseRefundCreateArguments } from '../actions/definitions/refund-create.action.js';
import { utcBudgetDay, type RefundBudgetRule } from './refund-budget-config.js';

// Called only inside the transaction that owns the execution row. Never dispatch here.
export class RefundBudgetLedger {
  constructor(private readonly rules: readonly RefundBudgetRule[]) {}

  async reserve(tx: Prisma.TransactionClient, execution: Execution, now: Date) {
    if (execution.actionName !== 'refund.create') return;
    const args = parseRefundCreateArguments(execution.arguments);
    const scope = { organizationId: execution.organizationId, environment: execution.environment, currency: args.currency };
    const rule = this.rules.find(r => r.organizationId === scope.organizationId && r.environment === scope.environment && r.currency === scope.currency);
    const existing = await tx.refundBudgetReservation.findUnique({ where: { executionId: execution.id } });
    if (existing) {
      if (existing.status !== 'HELD') throw new ConflictException('Refund budget reservation already settled');
      return; // Retries keep their original day/amount, even across midnight.
    }
    const day = utcBudgetDay(now);
    const key = { ...scope, day };
    let bucket = await tx.refundBudgetBucket.findUnique({ where: { organizationId_environment_currency_day: key } });
    if (!rule && !bucket) return; // Explicit opt-in. Existing daily buckets remain enforced after config removal.
    // Never silently retry an old unbudgeted operation under a newly enabled budget.
    if (execution.attemptCount > 1) throw new ConflictException({ statusCode: 409, error: 'Conflict', code: 'BUDGET_RESERVATION_MISSING', message: 'Existing operation requires budget review' });
    if (!bucket && rule) {
      const inserted = await tx.refundBudgetBucket.createMany({ skipDuplicates: true, data: [{ ...key, limitMinor: rule.limitMinor }] });
      if (inserted.count === 1) {
        // Activating a budget must not silently ignore prior effects today or ambiguous legacy work.
        const untracked = await tx.execution.findFirst({ where: {
          id: { not: execution.id }, ...{ organizationId: scope.organizationId, environment: scope.environment },
          actionName: 'refund.create', arguments: { path: ['currency'], equals: scope.currency },
          refundBudgetReservation: { is: null },
          OR: [
            { status: { in: ['EXECUTING', 'OUTCOME_UNKNOWN'] } },
            { status: 'SUCCEEDED', attempts: { some: { startedAt: { gte: day } } } },
          ],
        }, select: { id: true } });
        if (untracked) throw new ConflictException({ statusCode: 409, error: 'Conflict', code: 'BUDGET_BASELINE_REQUIRES_REVIEW', message: 'Unbudgeted refund history requires review before enabling this budget' });
      }
      bucket = await tx.refundBudgetBucket.findUniqueOrThrow({ where: { organizationId_environment_currency_day: key } });
    }
    if (!bucket) throw new ConflictException('Refund budget unavailable');
    // Freeze a day's cap. Config changes take effect next UTC day, never reset counters.
    if (rule && rule.limitMinor !== bucket.limitMinor) throw new ConflictException({ statusCode: 409, error: 'Conflict', code: 'BUDGET_CONFIGURATION_CHANGED', message: 'Daily budget limit is frozen until the next UTC day' });
    const exhausted = () => new ForbiddenException({ statusCode: 403, error: 'Forbidden', code: 'DAILY_REFUND_BUDGET_EXCEEDED', message: 'Daily refund budget exceeded', executionId: execution.id });
    if (args.amountMinor > bucket.limitMinor) throw exhausted();
    // Conditional UPDATE serializes reservations across different executions/agents.
    const changed = await tx.$executeRaw`UPDATE "RefundBudgetBucket"
      SET "reservedMinor" = "reservedMinor" + ${args.amountMinor}::integer
      WHERE "organizationId" = ${scope.organizationId}::uuid
        AND environment = ${scope.environment}::"ExecutionEnvironment" AND currency = ${scope.currency}
        AND day = ${day}::date
        AND "reservedMinor"::bigint + "consumedMinor"::bigint + ${args.amountMinor}::bigint <= "limitMinor"`;
    if (changed !== 1) throw exhausted();
    await tx.refundBudgetReservation.create({ data: { ...key, executionId: execution.id, amountMinor: args.amountMinor } });
  }

  async settle(tx: Prisma.TransactionClient, executionId: string, outcome: 'SUCCEEDED' | 'FAILED' | 'OUTCOME_UNKNOWN') {
    if (outcome === 'OUTCOME_UNKNOWN') return; // Absence/timeout never releases money.
    const reservation = await tx.refundBudgetReservation.findUnique({ where: { executionId } });
    if (!reservation || reservation.status !== 'HELD') return;
    const changed = await tx.refundBudgetReservation.updateMany({ where: { executionId, status: 'HELD' },
      data: { status: outcome === 'SUCCEEDED' ? 'CONSUMED' : 'RELEASED', settledAt: new Date() } });
    if (changed.count === 0) return;
    const { organizationId, environment, currency, day, amountMinor } = reservation;
    await tx.refundBudgetBucket.update({ where: { organizationId_environment_currency_day: { organizationId, environment, currency, day } },
      data: { reservedMinor: { decrement: amountMinor }, ...(outcome === 'SUCCEEDED' ? { consumedMinor: { increment: amountMinor } } : {}) } });
  }
}
