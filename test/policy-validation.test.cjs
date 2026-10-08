const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PolicyEngine, InvalidPolicyConfigurationError } = require('../dist/policies/policy-engine.js');
const engine = new PolicyEngine();
const request = {
  organizationId: '1832bd19-038d-49b8-895e-c45a71a9c606',
  principal: { type: 'agent', id: '1243ad83-6e58-4e62-8613-40c830fff17b' },
  action: { name: 'refund.create' },
  resource: { type: 'payment', id: 'payment_demo' },
  arguments: { amountMinor: 5000, currency: 'USD' },
  context: { environment: 'development', requestedAt: new Date('2026-10-08T00:00:00Z') },
};
const rule = (conditions, effect = 'ALLOW') => ({
  organizationId: request.organizationId, actionName: 'refund.create', effect, conditions,
});
const condition = (operator, value, field = 'arguments.amountMinor') => ({ field, operator, value });

test('invalid rules cannot be silently skipped in favor of an allow', () => {
  const allow = rule([]);
  const invalid = [
    { ...rule([]), effect: 'ALOW' },
    rule([condition('GTT', 5000)], 'DENY'),
    rule([condition('GT', '5000')], 'DENY'),
    rule([condition('GT', Infinity)], 'DENY'),
    rule([condition('EQ', 'x', 'arguments.__proto__')]),
    rule([condition('EQ', 'x', 'arguments.constructor')]),
    rule([condition('EQ', 'x', 'unknown.field')]),
    { ...rule([]), extra: true },
    { ...rule([]), organizationId: 'bad-id' },
    { ...rule([]), conditions: undefined },
    rule([condition('IN', [])]),
    rule([condition('EXISTS', 'true')]),
  ];
  for (const invalidRule of invalid) {
    assert.throws(() => engine.evaluate(request, [allow, invalidRule]), InvalidPolicyConfigurationError);
  }
  for (const input of [null, {}, undefined]) {
    assert.throws(() => engine.evaluate(request, input), InvalidPolicyConfigurationError);
  }
});

test('numeric comparisons respect boundaries and never coerce strings', () => {
  for (const [operator, threshold, expected] of [
    ['EQ', 5000, 'ALLOW'], ['NEQ', 5000, 'DENY'],
    ['GT', 4999, 'ALLOW'], ['GT', 5000, 'DENY'],
    ['GTE', 5000, 'ALLOW'], ['GTE', 5001, 'DENY'],
    ['LT', 5001, 'ALLOW'], ['LT', 5000, 'DENY'],
    ['LTE', 5000, 'ALLOW'], ['LTE', 4999, 'DENY'],
  ]) {
    assert.equal(engine.evaluate(request, [rule([condition(operator, threshold)])]), expected);
  }
  for (const value of ['5000', NaN, Infinity, undefined]) {
    const altered = { ...request, arguments: { amountMinor: value } };
    assert.equal(engine.evaluate(altered, [rule([condition('LTE', 5000)])]), 'DENY');
  }
});

test('membership, existence and trusted context fields are explicit', () => {
  const cases = [
    [condition('IN', ['USD', 'EUR'], 'arguments.currency'), 'ALLOW'],
    [condition('NOT_IN', ['EUR'], 'arguments.currency'), 'ALLOW'],
    [condition('NEQ', 'USD', 'arguments.currency'), 'DENY'],
    [condition('EXISTS', true, 'resource.id'), 'ALLOW'],
    [condition('EXISTS', false, 'arguments.missing'), 'ALLOW'],
    [condition('NEQ', 'x', 'arguments.missing'), 'DENY'],
    [condition('NOT_IN', ['x'], 'arguments.missing'), 'DENY'],
    [condition('EQ', 'development', 'context.environment'), 'ALLOW'],
    [condition('EQ', request.principal.id, 'principal.id'), 'ALLOW'],
    [condition('EQ', 'payment', 'resource.type'), 'ALLOW'],
  ];
  for (const [c, expected] of cases) {
    assert.equal(engine.evaluate(request, [rule([c])]), expected);
  }
  const inherited = { ...request, arguments: Object.create({ currency: 'USD' }) };
  assert.equal(engine.evaluate(inherited, [rule([condition('EQ', 'USD', 'arguments.currency')])]), 'DENY');
});

test('USD refund bands cover both approval boundaries and default deny', () => {
  const usd = condition('EQ', 'USD', 'arguments.currency');
  const policies = [
    rule([usd, condition('LTE', 5000)]),
    rule([usd, condition('GT', 5000), condition('LTE', 50000)], 'REQUIRE_APPROVAL'),
    rule([usd, condition('GT', 50000)], 'DENY'),
  ];
  for (const [amountMinor, expected] of [
    [4999, 'ALLOW'], [5000, 'ALLOW'], [5001, 'REQUIRE_APPROVAL'],
    [50000, 'REQUIRE_APPROVAL'], [50001, 'DENY'],
  ]) {
    const altered = { ...request, arguments: { ...request.arguments, amountMinor } };
    assert.equal(engine.evaluate(altered, policies), expected);
  }
  assert.equal(engine.evaluate({ ...request, action: { name: 'email.send' } }, policies), 'DENY');
  assert.equal(engine.evaluate({ ...request, arguments: { amountMinor: 5000, currency: 'EUR' } }, policies), 'DENY');
});
