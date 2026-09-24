require('reflect-metadata');

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  registerSchema,
} = require('../dist/auth/dto/register.dto.js');

const {
  PasswordService,
} = require('../dist/auth/password.service.js');

test('registration normalizes email but preserves password', () => {
  const password = '  a long secret phrase  ';

  const result = registerSchema.parse({
    email: '  USER@Example.com  ',
    password,
  });

  assert.equal(result.email, 'user@example.com');
  assert.equal(result.password, password);
});

test('registration rejects invalid input and unexpected fields', () => {
  const valid = {
    email: 'user@example.com',
    password: 'a sufficiently long passphrase',
  };

  const invalidInputs = [
    { ...valid, email: 'not-an-email' },
    { ...valid, password: 'short' },
    { ...valid, password: 'x'.repeat(129) },
    { ...valid, role: 'OWNER' },
    { email: valid.email },
  ];

  for (const input of invalidInputs) {
    assert.equal(registerSchema.safeParse(input).success, false);
  }
});

test('password hashing supports verification and uses unique salts', async () => {
  const service = new PasswordService();
  const password = 'a sufficiently long passphrase';

  const firstHash = await service.hash(password);
  const secondHash = await service.hash(password);

  assert.match(firstHash, /^\$argon2id\$/);
  assert.notEqual(firstHash, secondHash);

  assert.equal(await service.verify(firstHash, password), true);
  assert.equal(await service.verify(secondHash, password), true);
  assert.equal(
    await service.verify(firstHash, 'a different password'),
    false,
  );
});