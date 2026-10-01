const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ZodError } = require('zod');

const {
  ActionRegistry,
  UnknownActionError,
} = require('../dist/actions/action-registry.js');

const {
  ActionRequestFactory,
} = require('../dist/actions/action-request.factory.js');

function validSubmission() {
  return {
    action: {
      name: 'refund.create',
    },
    arguments: {
      paymentId: 'payment_123',
      amountMinor: 5000,
      currency: 'USD',
    },
  };
}

const identity = {
  agentId: 'verified-agent',
  organizationId: 'verified-organization',
  credentialId: 'verified-credential',
};

test('factory combines validated action with trusted identity and context', () => {
  const fixedTime = new Date('2026-10-01T07:00:00.000Z');

  const factory = new ActionRequestFactory(
    new ActionRegistry(),
    'production',
    () => fixedTime
  );

  const request = factory.create(identity, validSubmission());

  assert.deepEqual(request, {
    organizationId: 'verified-organization',
    principal: {
      type: 'agent',
      id: 'verified-agent',
    },
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
    context: {
      environment: 'production',
      requestedAt: fixedTime,
    },
  });
});

test('factory rejects client attempts to supply trusted fields', () => {
  const factory = new ActionRequestFactory(new ActionRegistry(), 'production');

  const attempts = [
    { organizationId: 'other-organization' },
    { agentId: 'other-agent' },
    { principal: { type: 'agent', id: 'other-agent' } },
    { environment: 'development' },
    { requestedAt: '2000-01-01T00:00:00.000Z' },
    { context: { environment: 'development' } },
    { resource: { type: 'payment', id: 'another-payment' } },
    { approved: true },
  ];

  for (const extraFields of attempts) {
    assert.throws(
      () =>
        factory.create(identity, {
          ...validSubmission(),
          ...extraFields,
        }),
      ZodError
    );
  }
});

test('factory validates the envelope and preserves registry rejections', () => {
  const factory = new ActionRequestFactory(new ActionRegistry(), 'development');

  for (const input of [
    null,
    {},
    { action: { name: 'refund.create' } },
    { ...validSubmission(), arguments: [] },
    {
      ...validSubmission(),
      action: {
        name: 'refund.create',
        approved: true,
      },
    },
  ]) {
    assert.throws(() => factory.create(identity, input), ZodError);
  }

  assert.throws(
    () =>
      factory.create(identity, {
        ...validSubmission(),
        action: { name: 'unknown.action' },
      }),
    UnknownActionError
  );

  const invalidRefund = validSubmission();
  invalidRefund.arguments.amountMinor = -1;

  assert.throws(() => factory.create(identity, invalidRefund), ZodError);
});

test('factory reads the clock for each new request', () => {
  let clockCalls = 0;

  const factory = new ActionRequestFactory(
    new ActionRegistry(),
    'development',
    () => {
      clockCalls += 1;
      return new Date(clockCalls * 1000);
    }
  );

  const first = factory.create(identity, validSubmission());
  const second = factory.create(identity, validSubmission());

  assert.equal(first.context.requestedAt.getTime(), 1000);
  assert.equal(second.context.requestedAt.getTime(), 2000);
  assert.equal(clockCalls, 2);
});
