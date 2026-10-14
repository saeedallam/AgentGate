export type ExecutionStatus =
  'DENIED' | 'RECEIVED' | 'EXECUTING' | 'SUCCEEDED' | 'FAILED' | 'OUTCOME_UNKNOWN';

const allowedTransitions: Readonly<
  Record<ExecutionStatus, readonly ExecutionStatus[]>
> = {
  RECEIVED: ['EXECUTING', 'DENIED'],

  DENIED: [],

  EXECUTING: ['SUCCEEDED', 'FAILED', 'OUTCOME_UNKNOWN'],

  SUCCEEDED: [],

  FAILED: [],

  OUTCOME_UNKNOWN: ['SUCCEEDED', 'FAILED'],
};

export class InvalidExecutionTransitionError extends Error {
  constructor(
    readonly from: ExecutionStatus,
    readonly to: ExecutionStatus
  ) {
    super(`Invalid execution transition: ${from} -> ${to}`);
    this.name = 'InvalidExecutionTransitionError';
  }
}

export function transitionExecution(
  current: ExecutionStatus,
  next: ExecutionStatus
): ExecutionStatus {
  const allowed = allowedTransitions[current];

  if (!allowed.includes(next)) {
    throw new InvalidExecutionTransitionError(current, next);
  }

  return next;
}

// Separate from ordinary lifecycle transitions: only the guarded recovery claim
// may dispatch another attempt. UNKNOWN never returns to RECEIVED.
export function retryExecution(current: ExecutionStatus): ExecutionStatus {
  if (current !== 'EXECUTING' && current !== 'OUTCOME_UNKNOWN') {
    throw new InvalidExecutionTransitionError(current, 'EXECUTING');
  }
  return 'EXECUTING';
}
