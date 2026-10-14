const { test } = require('node:test');
const assert = require('node:assert/strict');
const { retryWindow } = require('../dist/executions/recovery-contract.js');
test('recovery requires durable idempotency, expired lease, backoff and a bounded attempt budget', () => {
  const now = new Date(100000);
  const e = { recoveryVersion: 1, status: 'OUTCOME_UNKNOWN', attemptCount: 1, leaseExpiresAt: null, nextRetryAt: new Date(99000) };
  assert.equal(retryWindow(e, now), null);
  assert.equal(retryWindow({ ...e, recoveryVersion: 0 }, now), 'LEGACY_RECOVERY_UNSUPPORTED');
  assert.equal(retryWindow({ ...e, status: 'FAILED' }, now), 'EXECUTION_NOT_RETRYABLE');
  assert.equal(retryWindow({ ...e, status: 'EXECUTING', leaseExpiresAt: new Date(100001) }, now), 'EXECUTION_LEASE_ACTIVE');
  assert.equal(retryWindow({ ...e, nextRetryAt: new Date(100001) }, now), 'RETRY_BACKOFF');
  assert.equal(retryWindow({ ...e, attemptCount: 3 }, now), 'RETRY_LIMIT_REACHED');
});
