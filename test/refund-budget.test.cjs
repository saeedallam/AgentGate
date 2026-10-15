const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseRefundBudgets, utcBudgetDay } = require('../dist/budgets/refund-budget-config.js');
test('refund budgets validate tenant, environment, currency, integer minor units and duplicate scopes', () => {
  const rule = { organizationId: '1832bd19-038d-49b8-895e-c45a71a9c606', environment: 'development', currency: 'USD', limitMinor: 10000 };
  assert.deepEqual(parseRefundBudgets(JSON.stringify([rule])), [rule]);
  assert.deepEqual(parseRefundBudgets('[]'), []);
  for (const value of ['secret', JSON.stringify([rule,rule]), JSON.stringify([{...rule, limitMinor: 1.5}]), JSON.stringify([{...rule, limitMinor: -1}]), JSON.stringify([{...rule, currency: 'usd'}]), JSON.stringify([{...rule, extra: true}])]) {
    assert.throws(() => parseRefundBudgets(value), e => e.message === 'Invalid REFUND_BUDGETS_JSON configuration');
  }
  assert.equal(parseRefundBudgets(JSON.stringify([{...rule, limitMinor: 0}]))[0].limitMinor, 0);
});
test('refund budget days use UTC boundaries, independent of local timezone', () => {
  assert.equal(utcBudgetDay(new Date('2026-10-14T23:59:59.999Z')).toISOString(), '2026-10-14T00:00:00.000Z');
  assert.equal(utcBudgetDay(new Date('2026-10-15T00:00:00.000Z')).toISOString(), '2026-10-15T00:00:00.000Z');
});
