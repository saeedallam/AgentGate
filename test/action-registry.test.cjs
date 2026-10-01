const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ZodError } = require('zod');

const {
  ActionRegistry,
  UnknownActionError,
} = require('../dist/actions/action-registry.js');

test('refund action validates arguments and derives its resource', () => {
  const registry = new ActionRegistry();

  const result = registry.parse('refund.create', {
    paymentId: 'payment_123',
    amountMinor: 5000,
    currency: 'USD',
  });

  assert.deepEqual(result, {
    action: {
      name: 'refund.create',
    },
    resource: {
      type: 'payment',
      id: 'payment_123',
    },
    arguments: {
      paymentId: 'payment_123',
      amountMinor: 5000,
      currency: 'USD',
    },
  });
});

test('registry rejects unknown and non-exact action names', () => {
  const registry = new ActionRegistry();

  for (const name of [
    'unknown.action',
    'Refund.Create',
    ' refund.create',
    'refund.create ',
    'constructor',
    '__proto__',
  ]) {
    assert.throws(() => registry.parse(name, {}), UnknownActionError);
  }
});

test('refund action rejects malformed and unexpected arguments', () => {
  const registry = new ActionRegistry();

  const valid = {
    paymentId: 'payment_123',
    amountMinor: 5000,
    currency: 'USD',
  };

  const invalidInputs = [
    undefined,
    null,
    [],
    {},
    { ...valid, paymentId: '' },
    { ...valid, paymentId: ' payment_123' },
    { ...valid, paymentId: 'payment_123\n' },
    { ...valid, paymentId: 'a'.repeat(129) },
    { ...valid, amountMinor: 0 },
    { ...valid, amountMinor: -1 },
    { ...valid, amountMinor: 50.5 },
    { ...valid, amountMinor: '5000' },
    { ...valid, amountMinor: NaN },
    { ...valid, amountMinor: Infinity },
    { ...valid, amountMinor: Number.MAX_SAFE_INTEGER + 1 },
    { ...valid, currency: 'EUR' },
    { ...valid, currency: 'usd' },
    { ...valid, approved: true },
    { ...valid, organizationId: 'spoofed-organization' },
  ];

  for (const input of invalidInputs) {
    assert.throws(() => registry.parse('refund.create', input), ZodError);
  }
});

test('validation does not impose future policy thresholds', () => {
  const registry = new ActionRegistry();

  const result = registry.parse('refund.create', {
    paymentId: 'payment_123',
    amountMinor: 300000,
    currency: 'USD',
  });

  assert.equal(result.arguments.amountMinor, 300000);
  assert.equal(Object.hasOwn(result, 'decision'), false);
});
