// Limits apply to dispatch attempts, not read-only reconciliation.
export const MAX_EXECUTION_ATTEMPTS = 3;
export const EXECUTION_LEASE_MS = 30_000;
export const retryDelayMs = (attemptNumber: number) => 2_000 * 2 ** Math.max(0, attemptNumber - 1);

export function retryWindow(execution: {
  recoveryVersion: number; status: string; attemptCount: number;
  leaseExpiresAt: Date | null; nextRetryAt: Date | null;
}, now: Date): string | null {
  if (execution.recoveryVersion !== 1) return 'LEGACY_RECOVERY_UNSUPPORTED';
  if (!['EXECUTING', 'OUTCOME_UNKNOWN'].includes(execution.status)) return 'EXECUTION_NOT_RETRYABLE';
  if (execution.status === 'EXECUTING' && (!execution.leaseExpiresAt || execution.leaseExpiresAt > now)) return 'EXECUTION_LEASE_ACTIVE';
  if (execution.nextRetryAt && execution.nextRetryAt > now) return 'RETRY_BACKOFF';
  if (execution.attemptCount >= MAX_EXECUTION_ATTEMPTS) return 'RETRY_LIMIT_REACHED';
  return null;
}
