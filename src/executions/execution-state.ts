export type ExecutionStatus =
  'RECEIVED' | 'EXECUTING' | 'SUCCEEDED' | 'FAILED' | 'OUTCOME_UNKNOWN';

const allowedTransitions: Readonly<
  Record<ExecutionStatus, readonly ExecutionStatus[]>
> = {
  RECEIVED: ['EXECUTING'],

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
