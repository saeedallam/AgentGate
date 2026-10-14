import { ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import type { ActionRequest } from '../actions/action-request.js';
import { parseRefundCreateArguments } from '../actions/definitions/refund-create.action.js';
import { actionJson } from '../executions/action-json.js';
import type { ExecutionOutcome } from '../executions/executions.service.js';
import { PrismaService } from '../infrastructure/database/prisma.service.js';
import type { ActionProvider, ConfirmedOutcome, ProviderLookup } from '../providers/action-provider.js';

const outcomeSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('SUCCEEDED'), result: z.record(z.string(), z.json()) }),
  z.strictObject({ status: z.literal('FAILED'), errorCode: z.string().min(1) }),
]);

@Injectable()
export class FakeCommerceProvider implements ActionProvider {
  readonly recoveryVersion = 1 as const;
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  async lookup(id: string, request: ActionRequest): Promise<ProviderLookup> {
    const receipt = await this.prisma.fakeProviderReceipt.findFirst({
      where: { executionId: id, organizationId: request.organizationId },
    });
    if (!receipt) return { status: 'NOT_FOUND' };
    if (receipt.requestHash !== actionJson(request).hash) throw new ConflictException('Provider operation payload mismatch');
    return { status: 'FOUND', outcome: outcomeSchema.parse(receipt.outcome) };
  }

  async execute(id: string, request: ActionRequest): Promise<ExecutionOutcome> {
    const hash = actionJson(request).hash;
    const stored = await this.prisma.execution.findFirst({ where: {
      id, organizationId: request.organizationId, agentId: request.principal.id, requestHash: hash,
    } });
    if (!stored) throw new ConflictException('Provider operation binding mismatch');
    // Lookup precedes scenario simulation: a committed outcome is never executed again.
    const previous = await this.lookup(id, request);
    if (previous.status === 'FOUND') return previous.outcome;
    const scenario = this.config.get<string>('FAKE_COMMERCE_SCENARIO', 'success');
    if (scenario === 'timeout' || scenario === 'error') {
      return { status: 'OUTCOME_UNKNOWN', errorCode: scenario === 'timeout' ? 'FAKE_TIMEOUT' : 'FAKE_PROVIDER_500' };
    }
    if (scenario === 'delayed') await new Promise(resolve => setTimeout(resolve, 100));
    const outcome = await this.prisma.$transaction(async tx => {
      // The unique receipt serializes duplicate operation keys, including late workers.
      // The placeholder, effect and final receipt commit together or all roll back.
      const inserted = await tx.fakeProviderReceipt.createMany({ skipDuplicates: true, data: [{
        executionId: id, organizationId: request.organizationId, requestHash: hash,
      }] });
      if (inserted.count === 0) {
        const winner = await tx.fakeProviderReceipt.findUniqueOrThrow({ where: { executionId: id } });
        if (winner.organizationId !== request.organizationId || winner.requestHash !== hash) throw new ConflictException('Provider operation payload mismatch');
        return outcomeSchema.parse(winner.outcome);
      }
      let result: ConfirmedOutcome;
      if (request.action.name !== 'refund.create') {
        result = { status: 'FAILED', errorCode: 'UNSUPPORTED_FAKE_ACTION' };
      } else if (scenario === 'reject') {
        result = { status: 'FAILED', errorCode: 'FAKE_VALIDATION_REJECTED' };
      } else {
        const args = parseRefundCreateArguments(request.arguments);
        const payment = await tx.fakePayment.findUnique({ where: {
          organizationId_id: { organizationId: request.organizationId, id: args.paymentId },
        } });
        if (!payment) result = { status: 'FAILED', errorCode: 'PAYMENT_NOT_FOUND' };
        else if (payment.currency !== args.currency || args.amountMinor > payment.amountMinor) {
          result = { status: 'FAILED', errorCode: 'INVALID_REFUND_AMOUNT' };
        } else {
          const changed = await tx.fakePayment.updateMany({
            where: { organizationId: request.organizationId, id: args.paymentId, refunded: false },
            data: { refunded: true, refundExecutionId: id },
          });
          result = changed.count !== 1
            ? { status: 'FAILED', errorCode: 'PAYMENT_ALREADY_REFUNDED' }
            : { status: 'SUCCEEDED', result: { simulated: true, refundId: 'fake_' + id,
              paymentId: args.paymentId, amountMinor: args.amountMinor, currency: args.currency } };
        }
      }
      await tx.fakeProviderReceipt.update({ where: { executionId: id }, data: { outcome: result } });
      return result;
    });
    if (scenario === 'unknown' && outcome.status === 'SUCCEEDED') {
      return { status: 'OUTCOME_UNKNOWN', errorCode: 'FAKE_RESPONSE_LOST_AFTER_EFFECT' };
    }
    return outcome;
  }
}
