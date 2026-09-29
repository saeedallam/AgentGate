require('reflect-metadata');

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  AgentKeyService,
} = require('../dist/agent-credentials/agent-key.service.js');

test('agent key generation returns the expected format and prefix', () => {
  const service = new AgentKeyService();

  const generated = service.generate();

  assert.match(generated.apiKey, /^agt_live_[a-f0-9]{32}_[a-f0-9]{64}$/);

  assert.match(generated.keyPrefix, /^agt_live_[a-f0-9]{32}$/);

  assert.match(generated.keyHash, /^[a-f0-9]{64}$/);

  assert.equal(service.getPrefix(generated.apiKey), generated.keyPrefix);

  assert.notEqual(generated.keyHash, generated.apiKey);
});

test('agent key verification accepts the original key', () => {
  const service = new AgentKeyService();
  const generated = service.generate();

  const accepted = service.verify(generated.apiKey, generated.keyHash);

  assert.equal(accepted, true);
});

test('agent key verification rejects a changed secret or prefix', () => {
  const service = new AgentKeyService();
  const generated = service.generate();

  const secretStart = generated.keyPrefix.length + 1;
  const currentCharacter = generated.apiKey[secretStart];
  const replacement = currentCharacter === 'a' ? 'b' : 'a';

  const changedSecret =
    generated.apiKey.slice(0, secretStart) +
    replacement +
    generated.apiKey.slice(secretStart + 1);

  assert.equal(service.verify(changedSecret, generated.keyHash), false);

  const publicIdStart = 'agt_live_'.length;
  const currentPublicCharacter = generated.apiKey[publicIdStart];
  const publicReplacement = currentPublicCharacter === 'a' ? 'b' : 'a';

  const changedPrefix =
    generated.apiKey.slice(0, publicIdStart) +
    publicReplacement +
    generated.apiKey.slice(publicIdStart + 1);

  assert.equal(service.verify(changedPrefix, generated.keyHash), false);
});

test('agent key parsing rejects malformed input without normalizing it', () => {
  const service = new AgentKeyService();
  const generated = service.generate();

  const invalidInputs = [
    undefined,
    null,
    123,
    {},
    '',
    generated.keyPrefix,
    generated.apiKey.slice(0, -1),
    `${generated.apiKey}0`,
    ` ${generated.apiKey}`,
    `${generated.apiKey} `,
    `${generated.apiKey}\n`,
    generated.apiKey.toUpperCase(),
  ];

  for (const input of invalidInputs) {
    assert.equal(service.getPrefix(input), null);

    assert.equal(service.verify(input, generated.keyHash), false);
  }
});

test('agent key verification rejects malformed stored hashes', () => {
  const service = new AgentKeyService();
  const generated = service.generate();

  const invalidHashes = [
    '',
    'abc',
    'g'.repeat(64),
    'a'.repeat(63),
    'a'.repeat(65),
    `${generated.keyHash}\n`,
  ];

  for (const storedHash of invalidHashes) {
    assert.equal(service.verify(generated.apiKey, storedHash), false);
  }
});
