import { ForbiddenException } from '@nestjs/common';
import type { PolicyDecision } from '../policies/policy.js';

import type { BlockCode } from './action-block-code.js';

type BlockDetails = {
  executionId: string;
  decision?: PolicyDecision;
  approvalId?: string | null;
  approvalStatus?: 'PENDING' | 'APPROVED' | 'REJECTED' | null;
};

export function blocked(code: BlockCode, message: string, details: BlockDetails) {
  return new ForbiddenException({ ...details, statusCode: 403, error: 'Forbidden', code, message });
}
