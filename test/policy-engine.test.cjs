const { test } = require('node:test');
const assert = require('node:assert/strict');

const { PolicyEngine } = require('../dist/policies/policy-engine.js');

test('policy engine denies a request when no policies exist', () => {
  const request = {
    organizationId: '1832bd19-038d-49b8-895e-c45a71a9c606',
    principal: { type: 'agent', id: '1243ad83-6e58-4e62-8613-40c830fff17b' },
    action: { name: 'refund.create' },
    resource: { type: 'payment', id: 'payment_demo' },
    arguments: { paymentId: 'payment_demo', amountMinor: 5000, currency: 'USD' },
    context: {
      environment: 'development',
      requestedAt: new Date('2026-10-05T00:00:00.000Z'),
    },
  };

  const decision = new PolicyEngine().evaluate(request, []);

  assert.equal(decision, 'DENY');
});

test('policy engine allows a USD refund at the configured amount limit', () => {
  const request = {
    organizationId: '1832bd19-038d-49b8-895e-c45a71a9c606',
    principal: { type: 'agent', id: '1243ad83-6e58-4e62-8613-40c830fff17b' },
    action: { name: 'refund.create' },
    resource: { type: 'payment', id: 'payment_demo' },
    arguments: { paymentId: 'payment_demo', amountMinor: 5000, currency: 'USD' },
    context: {
      environment: 'development',
      requestedAt: new Date('2026-10-05T00:00:00.000Z'),
    },
  };
  const policies = [{
    organizationId: request.organizationId,
    actionName: 'refund.create',
    effect: 'ALLOW',
    conditions: [
      { field: 'arguments.currency', operator: 'EQ', value: 'USD' },
      { field: 'arguments.amountMinor', operator: 'LTE', value: 5000 },
    ],
  }];

  const decision = new PolicyEngine().evaluate(request, policies);

  assert.equal(decision, 'ALLOW');
});

test('matching deny overrides allow regardless of policy order', () => {
  const request = {
    organizationId: '1832bd19-038d-49b8-895e-c45a71a9c606',
    principal: { type: 'agent', id: '1243ad83-6e58-4e62-8613-40c830fff17b' },
    action: { name: 'refund.create' },
    resource: { type: 'payment', id: 'payment_demo' },
    arguments: { paymentId: 'payment_demo', amountMinor: 5000, currency: 'USD' },
    context: {
      environment: 'development',
      requestedAt: new Date('2026-10-05T00:00:00.000Z'),
    },
  };
  const allow = {
    organizationId: request.organizationId,
    actionName: 'refund.create',
    effect: 'ALLOW',
    conditions: [
      { field: 'arguments.currency', operator: 'EQ', value: 'USD' },
      { field: 'arguments.amountMinor', operator: 'LTE', value: 5000 },
    ],
  };
  const deny = { ...allow, effect: 'DENY' };
  const engine = new PolicyEngine();

  const decisions = [
    engine.evaluate(request, [allow, deny]),
    engine.evaluate(request, [deny, allow]),
  ];

  assert.deepEqual(decisions, ['DENY', 'DENY']);
});

test('matching approval overrides allow regardless of policy order', () => {
  const request = {
    organizationId: '1832bd19-038d-49b8-895e-c45a71a9c606',
    principal: { type: 'agent', id: '1243ad83-6e58-4e62-8613-40c830fff17b' },
    action: { name: 'refund.create' },
    resource: { type: 'payment', id: 'payment_demo' },
    arguments: { paymentId: 'payment_demo', amountMinor: 5000, currency: 'USD' },
    context: {
      environment: 'development',
      requestedAt: new Date('2026-10-05T00:00:00.000Z'),
    },
  };
  const allow = {
    organizationId: request.organizationId,
    actionName: 'refund.create',
    effect: 'ALLOW',
    conditions: [
      { field: 'arguments.currency', operator: 'EQ', value: 'USD' },
      { field: 'arguments.amountMinor', operator: 'LTE', value: 5000 },
    ],
  };
  const approval = { ...allow, effect: 'REQUIRE_APPROVAL' };
  const engine = new PolicyEngine();

  const decisions = [
    engine.evaluate(request, [allow, approval]),
    engine.evaluate(request, [approval, allow]),
  ];

  assert.deepEqual(decisions, ['REQUIRE_APPROVAL', 'REQUIRE_APPROVAL']);
});

test('matching deny overrides approval and allow in all six orders', () => {
  const request = {
    organizationId: '1832bd19-038d-49b8-895e-c45a71a9c606',
    principal: { type: 'agent', id: '1243ad83-6e58-4e62-8613-40c830fff17b' },
    action: { name: 'refund.create' },
    resource: { type: 'payment', id: 'payment_demo' },
    arguments: { paymentId: 'payment_demo', amountMinor: 5000, currency: 'USD' },
    context: {
      environment: 'development',
      requestedAt: new Date('2026-10-05T00:00:00.000Z'),
    },
  };
  const allow = {
    organizationId: request.organizationId,
    actionName: 'refund.create',
    effect: 'ALLOW',
    conditions: [
      { field: 'arguments.currency', operator: 'EQ', value: 'USD' },
      { field: 'arguments.amountMinor', operator: 'LTE', value: 5000 },
    ],
  };
  const deny = { ...allow, effect: 'DENY' };
  const approval = { ...allow, effect: 'REQUIRE_APPROVAL' };
  const engine = new PolicyEngine();

  const decisions = [
    engine.evaluate(request, [allow, approval, deny]),
    engine.evaluate(request, [allow, deny, approval]),
    engine.evaluate(request, [approval, allow, deny]),
    engine.evaluate(request, [approval, deny, allow]),
    engine.evaluate(request, [deny, allow, approval]),
    engine.evaluate(request, [deny, approval, allow]),
  ];

  assert.deepEqual(decisions, Array(6).fill('DENY'));
});

test('nonmatching deny does not override a matching allow', () => {
  const request = {
    organizationId: '1832bd19-038d-49b8-895e-c45a71a9c606',
    principal: { type: 'agent', id: '1243ad83-6e58-4e62-8613-40c830fff17b' },
    action: { name: 'refund.create' },
    resource: { type: 'payment', id: 'payment_demo' },
    arguments: { paymentId: 'payment_demo', amountMinor: 5000, currency: 'USD' },
    context: {
      environment: 'development',
      requestedAt: new Date('2026-10-05T00:00:00.000Z'),
    },
  };
  const allow = {
    organizationId: request.organizationId,
    actionName: 'refund.create',
    effect: 'ALLOW',
    conditions: [
      { field: 'arguments.currency', operator: 'EQ', value: 'USD' },
      { field: 'arguments.amountMinor', operator: 'LTE', value: 5000 },
    ],
  };
  const deny = {
    ...allow,
    effect: 'DENY',
    conditions: [
      { field: 'arguments.currency', operator: 'EQ', value: 'EUR' },
    ],
  };
  const engine = new PolicyEngine();

  const decisions = [
    engine.evaluate(request, [allow, deny]),
    engine.evaluate(request, [deny, allow]),
  ];

  assert.deepEqual(decisions, ['ALLOW', 'ALLOW']);
});

test('allow amount limit includes the boundary and rejects one cent above', () => {
  const request = {
    organizationId: '1832bd19-038d-49b8-895e-c45a71a9c606',
    principal: { type: 'agent', id: '1243ad83-6e58-4e62-8613-40c830fff17b' },
    action: { name: 'refund.create' },
    resource: { type: 'payment', id: 'payment_demo' },
    arguments: { paymentId: 'payment_demo', amountMinor: 5000, currency: 'USD' },
    context: {
      environment: 'development',
      requestedAt: new Date('2026-10-05T00:00:00.000Z'),
    },
  };
  const allow = {
    organizationId: request.organizationId,
    actionName: 'refund.create',
    effect: 'ALLOW',
    conditions: [
      { field: 'arguments.currency', operator: 'EQ', value: 'USD' },
      { field: 'arguments.amountMinor', operator: 'LTE', value: 5000 },
    ],
  };
  const engine = new PolicyEngine();
  const cases = [
    [4999, 'ALLOW'],
    [5000, 'ALLOW'],
    [5001, 'DENY'],
    [4900, 'ALLOW'],
  ];

  for (const [amountMinor, expected] of cases) {
    const candidate = {
      ...request,
      arguments: { ...request.arguments, amountMinor },
    };
    assert.equal(
      engine.evaluate(candidate, [allow]),
      expected,
      `Unexpected decision for ${amountMinor} cents`,
    );
  }
});

test('allow rule from another organization cannot authorize the request', () => {
  const request = {
    organizationId: '1832bd19-038d-49b8-895e-c45a71a9c606',
    principal: { type: 'agent', id: '1243ad83-6e58-4e62-8613-40c830fff17b' },
    action: { name: 'refund.create' },
    resource: { type: 'payment', id: 'payment_demo' },
    arguments: { paymentId: 'payment_demo', amountMinor: 5000, currency: 'USD' },
    context: {
      environment: 'development',
      requestedAt: new Date('2026-10-05T00:00:00.000Z'),
    },
  };
  const allow = {
    organizationId: request.organizationId,
    actionName: 'refund.create',
    effect: 'ALLOW',
    conditions: [
      { field: 'arguments.currency', operator: 'EQ', value: 'USD' },
      { field: 'arguments.amountMinor', operator: 'LTE', value: 5000 },
    ],
  };
  const engine = new PolicyEngine();
  const foreignAllow = {
    ...allow,
    organizationId: '55059eb2-2eaf-4def-a294-0be25e5099c8',
  };

  assert.equal(engine.evaluate(request, [allow]), 'ALLOW');
  assert.equal(engine.evaluate(request, [foreignAllow]), 'DENY');
});
