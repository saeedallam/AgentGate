const { test } = require('node:test');
const assert = require('node:assert/strict');
const { actionJson } = require('../dist/executions/action-json.js');
const request = {
  organizationId: 'org', principal: { type: 'agent', id: 'agent' },
  action: { name: 'test' }, arguments: { a: 1, b: 2 },
  context: { environment: 'development', requestedAt: new Date() },
};
test('request digest ignores key order and receipt time but binds action context', () => {
  const first = actionJson(request).hash;
  assert.equal(first, actionJson({ ...request, arguments: { b: 2, a: 1 },
    context: { ...request.context, requestedAt: new Date(0) } }).hash);
  for (const changes of [{ organizationId: 'other' }, { arguments: { a: 3 } },
    { context: { ...request.context, environment: 'staging' } }]) {
    assert.notEqual(first, actionJson({ ...request, ...changes }).hash);
  }
});
test('JSON persistence rejects non-JSON values instead of silently losing data', () => {
  for (const value of [undefined, NaN, Infinity, new Date(), BigInt(1)]) {
    assert.throws(() => actionJson({ ...request, arguments: { value } }));
  }
});
