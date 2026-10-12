export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export class InvalidApprovalTransitionError extends Error {
  constructor(
    readonly from: ApprovalStatus,
    readonly to: ApprovalStatus,
  ) {
    super(`Invalid approval transition: ${from} -> ${to}`);
    this.name = 'InvalidApprovalTransitionError';
  }
}

export function transitionApproval(
  current: ApprovalStatus,
  next: ApprovalStatus,
): ApprovalStatus {
  if (current !== 'PENDING' || (next !== 'APPROVED' && next !== 'REJECTED')) {
    throw new InvalidApprovalTransitionError(current, next);
  }

  return next;
}
