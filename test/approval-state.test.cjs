const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  transitionApproval,
  InvalidApprovalTransitionError,
} = require('../dist/approvals/approval-state.js');

test('a rejected approval cannot become approved', () => {
  assert.throws(
    () => transitionApproval('REJECTED', 'APPROVED'),
    InvalidApprovalTransitionError,
  );
});

test('pending approval can be approved or rejected', () => {
  assert.equal(transitionApproval('PENDING', 'APPROVED'), 'APPROVED');
  assert.equal(transitionApproval('PENDING', 'REJECTED'), 'REJECTED');
});

test('all other approval transitions are forbidden', () => {
  const forbidden = [
    ['PENDING', 'PENDING'],
    ['APPROVED', 'PENDING'],
    ['APPROVED', 'APPROVED'],
    ['APPROVED', 'REJECTED'],
    ['REJECTED', 'PENDING'],
    ['REJECTED', 'REJECTED'],
  ];

  for (const [from, to] of forbidden) {
    assert.throws(
      () => transitionApproval(from, to),
      (error) => error instanceof InvalidApprovalTransitionError
        && error.from === from && error.to === to,
    );
  }
});
