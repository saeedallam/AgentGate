import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ActionRequest } from '../actions/action-request.js';
import { parseRefundCreateArguments } from '../actions/definitions/refund-create.action.js';
import type { ExecutionOutcome } from '../executions/executions.service.js';
import { PrismaService } from '../infrastructure/database/prisma.service.js';

@Injectable()
export class FakeCommerceProvider {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  async execute(id: string, request: ActionRequest): Promise<ExecutionOutcome> {
    if (request.action.name !== 'refund.create') return { status: 'FAILED', errorCode: 'UNSUPPORTED_FAKE_ACTION' };
    const args = parseRefundCreateArguments(request.arguments);
    const scenario = this.config.get<string>('FAKE_COMMERCE_SCENARIO', 'success');
    if (scenario === 'reject') return { status: 'FAILED', errorCode: 'FAKE_VALIDATION_REJECTED' };
    if (scenario === 'timeout' || scenario === 'error') {
      return { status: 'OUTCOME_UNKNOWN', errorCode: scenario === 'timeout' ? 'FAKE_TIMEOUT' : 'FAKE_PROVIDER_500' };
    }
    if (scenario === 'delayed') await new Promise(resolve => setTimeout(resolve, 100));
    const outcome = await this.prisma.$transaction(async tx => {
      const payment = await tx.fakePayment.findUnique({
        where: { organizationId_id: { organizationId: request.organizationId, id: args.paymentId } },
      });
      if (!payment) return { status: 'FAILED', errorCode: 'PAYMENT_NOT_FOUND' } as const;
      if (payment.currency !== args.currency || args.amountMinor > payment.amountMinor) {
        return { status: 'FAILED', errorCode: 'INVALID_REFUND_AMOUNT' } as const;
      }
      const changed = await tx.fakePayment.updateMany({
        where: { organizationId: request.organizationId, id: args.paymentId, refunded: false },
        data: { refunded: true, refundExecutionId: id },
      });
      if (changed.count !== 1) return { status: 'FAILED', errorCode: 'PAYMENT_ALREADY_REFUNDED' } as const;
      return { status: 'SUCCEEDED', result: {
        simulated: true, refundId: 'fake_' + id,
        paymentId: args.paymentId, amountMinor: args.amountMinor, currency: args.currency,
      } } as const;
    });
    if (scenario === 'unknown' && outcome.status === 'SUCCEEDED') {
      return { status: 'OUTCOME_UNKNOWN', errorCode: 'FAKE_RESPONSE_LOST_AFTER_EFFECT' };
    }
    return outcome;
  }
}
