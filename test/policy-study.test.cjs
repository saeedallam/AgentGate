const { test } = require('node:test');
const assert = require('node:assert/strict');
const { summarizeDecisions } = require('../dist/observations/policy-study.js');
test('policy study counts would-decisions separately from skipped history', () => {
  assert.deepEqual(summarizeDecisions([{ decision: 'ALLOW' }, { decision: 'DENY' }, { decision: 'REQUIRE_APPROVAL' }, { skipped: 'INTEGRITY_MISMATCH' }]),
    { allow: 1, deny: 1, requireApproval: 1, skipped: 1 });
});
