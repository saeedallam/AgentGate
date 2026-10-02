const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  transitionExecution,
  InvalidExecutionTransitionError,
} = require('../dist/executions/execution-state.js');

test('execution can start only after receipt and record its outcome', () => {
  const executing = transitionExecution('RECEIVED', 'EXECUTING');

  assert.equal(executing, 'EXECUTING');

  for (const outcome of ['SUCCEEDED', 'FAILED', 'OUTCOME_UNKNOWN']) {
    assert.equal(transitionExecution(executing, outcome), outcome);
  }
});

test('received execution cannot skip directly to an outcome', () => {
  for (const outcome of ['SUCCEEDED', 'FAILED', 'OUTCOME_UNKNOWN']) {
    assert.throws(
      () => transitionExecution('RECEIVED', outcome),
      InvalidExecutionTransitionError
    );
  }
});

test('unknown outcome can be resolved but cannot restart execution', () => {
  assert.equal(
    transitionExecution('OUTCOME_UNKNOWN', 'SUCCEEDED'),
    'SUCCEEDED'
  );

  assert.equal(transitionExecution('OUTCOME_UNKNOWN', 'FAILED'), 'FAILED');

  assert.throws(
    () => transitionExecution('OUTCOME_UNKNOWN', 'EXECUTING'),
    InvalidExecutionTransitionError
  );

  assert.throws(
    () => transitionExecution('OUTCOME_UNKNOWN', 'RECEIVED'),
    InvalidExecutionTransitionError
  );
});

test('terminal executions cannot change state', () => {
  const statuses = [
    'RECEIVED',
    'EXECUTING',
    'SUCCEEDED',
    'FAILED',
    'OUTCOME_UNKNOWN',
  ];

  for (const terminal of ['SUCCEEDED', 'FAILED']) {
    for (const next of statuses) {
      assert.throws(
        () => transitionExecution(terminal, next),
        InvalidExecutionTransitionError
      );
    }
  }
});

test('execution cannot move backwards or transition to the same state', () => {
  const invalidPairs = [
    ['EXECUTING', 'RECEIVED'],
    ['RECEIVED', 'RECEIVED'],
    ['EXECUTING', 'EXECUTING'],
    ['OUTCOME_UNKNOWN', 'OUTCOME_UNKNOWN'],
  ];

  for (const [current, next] of invalidPairs) {
    assert.throws(
      () => transitionExecution(current, next),
      InvalidExecutionTransitionError
    );
  }
});

test('invalid transition error identifies the attempted transition', () => {
  assert.throws(
    () => transitionExecution('SUCCEEDED', 'EXECUTING'),
    (error) => {
      assert.ok(error instanceof InvalidExecutionTransitionError);

      assert.equal(error.from, 'SUCCEEDED');
      assert.equal(error.to, 'EXECUTING');

      return true;
    }
  );
});
