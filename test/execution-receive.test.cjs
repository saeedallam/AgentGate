require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ExecutionsService } = require('../dist/executions/executions.service.js');
const { actionJson } = require('../dist/executions/action-json.js');
const request = { organizationId: '1832bd19-038d-49b8-895e-c45a71a9c606', principal: { type: 'agent', id: '1243ad83-6e58-4e62-8613-40c830fff17b' }, action: { name: 'refund.create' }, arguments: { paymentId: 'p', amountMinor: 100, currency: 'USD' }, context: { environment: 'development', requestedAt: new Date() } };
const snapshot = { policyDecision: 'ALLOW', policyReason: 'MATCHED_ALLOW', policyHash: 'a'.repeat(64), policyEvaluatedAt: new Date() };

test('receipt race returns the winner decision and never overwrites it with the loser allowance', async () => {
  const winner = { id: 'winner', requestHash: actionJson(request).hash, policyDecision: 'DENY' };
  let lookups = 0;
  const service = new ExecutionsService({
    execution: { findFirst: async () => { lookups++; return null; } },
    $transaction: async callback => callback({ execution: { createMany: async input => {
      assert.equal(input.skipDuplicates, true); return { count: 0 };
    }, findFirstOrThrow: async () => { lookups++; return winner; } } }),
  }, new (require('@nestjs/config').ConfigService)({ REFUND_BUDGETS_JSON: '[]' }));
  assert.equal(await service.receive(request, 'key', () => snapshot), winner);
  assert.equal(lookups, 2);
});

test('existing receipts bypass evaluation and reject changed payload before permission checks', async () => {
  const winner = { requestHash: actionJson(request).hash, policyDecision: 'DENY' };
  const service = new ExecutionsService({ execution: { findFirst: async () => winner } }, new (require('@nestjs/config').ConfigService)({ REFUND_BUDGETS_JSON: '[]' }));
  const forbidden = () => { assert.fail('replay must not evaluate a new initial decision'); };
  assert.equal(await service.receive(request, 'key', forbidden), winner);
  await assert.rejects(service.receive({ ...request, arguments: { ...request.arguments, amountMinor: 200 } }, 'key', forbidden), e => e.getStatus() === 409);
});
