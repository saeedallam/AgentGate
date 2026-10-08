const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PolicyStore } = require('../dist/policies/policy-store.js');
const { InvalidPolicyConfigurationError } = require('../dist/policies/policy-engine.js');
const orgA = '1832bd19-038d-49b8-895e-c45a71a9c606';
const orgB = '55059eb2-2eaf-4def-a294-0be25e5099c8';
const rule = (organizationId, effect = 'ALLOW') => ({
  organizationId, actionName: 'refund.create', effect,
  conditions: [{ field: 'arguments.amountMinor', operator: 'LTE', value: 5000 }],
});

test('policy store returns only rules belonging to the requested organization', () => {
  const store = new PolicyStore(JSON.stringify([rule(orgA), rule(orgB, 'DENY')]));
  assert.deepEqual(store.forOrganization(orgA), [rule(orgA)]);
  assert.deepEqual(store.forOrganization(orgB), [rule(orgB, 'DENY')]);
  assert.deepEqual(store.forOrganization('8bf1e82c-59e3-4390-a206-a60bf56a43bb'), []);
  assert.deepEqual(new PolicyStore().forOrganization(orgA), []);
});

test('policy configuration rejects malformed JSON and invalid rules without leaking content', () => {
  for (const raw of ['private-value', '{"private-value":', 'null', '{}',
    JSON.stringify([{ ...rule(orgA), effect: 'private-value' }]),
    JSON.stringify([rule(orgA), { ...rule(orgB), conditions: null }]),
    ' '.repeat(262145),
  ]) {
    assert.throws(() => new PolicyStore(raw), (error) =>
      error instanceof InvalidPolicyConfigurationError
      && error.message === 'Invalid policy configuration');
  }
});

test('returned policies cannot mutate the stored snapshot including nested values', () => {
  const stored = rule(orgA);
  stored.conditions = [{ field: 'arguments.currency', operator: 'IN', value: ['USD'] }];
  const store = new PolicyStore(JSON.stringify([stored]));
  const first = store.forOrganization(orgA);
  first[0].effect = 'DENY';
  first[0].conditions[0].value.push('EUR');
  first.push(rule(orgB));
  assert.deepEqual(store.forOrganization(orgA), [stored]);
});
