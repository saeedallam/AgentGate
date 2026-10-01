require('reflect-metadata');

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { UnauthorizedException } = require('@nestjs/common');

const {
  AgentAuthGuard,
} = require('../dist/agent-credentials/agent-auth.guard.js');

function createContext(request) {
  return {
    switchToHttp() {
      return {
        getRequest() {
          return request;
        },
      };
    },
  };
}

test('agent guard assigns only the identity returned by authentication', async () => {
  const verifiedIdentity = {
    agentId: 'verified-agent',
    organizationId: 'verified-organization',
    credentialId: 'verified-credential',
  };

  let receivedKey;

  const authentication = {
    async authenticate(apiKey) {
      receivedKey = apiKey;
      return verifiedIdentity;
    },
  };

  const guard = new AgentAuthGuard(authentication);

  const request = {
    headers: {
      authorization: 'Bearer opaque-test-key',
    },
    body: {
      organizationId: 'untrusted-organization',
    },
    agent: {
      agentId: 'untrusted-agent',
      organizationId: 'untrusted-organization',
      credentialId: 'untrusted-credential',
    },
  };

  const allowed = await guard.canActivate(createContext(request));

  assert.equal(allowed, true);
  assert.equal(receivedKey, 'opaque-test-key');
  assert.deepEqual(request.agent, verifiedIdentity);
});

test('agent guard rejects malformed headers before calling authentication', async () => {
  let authenticationCalls = 0;

  const guard = new AgentAuthGuard({
    async authenticate() {
      authenticationCalls += 1;
      throw new Error('Authentication should not be called');
    },
  });

  const invalidHeaders = [
    undefined,
    '',
    'Basic something',
    'Bearer',
    'Bearer ',
    'Bearer key extra',
    'Bearer key\n',
    `Bearer ${'a'.repeat(300)}`,
    ['Bearer first', 'Bearer second'],
  ];

  for (const authorization of invalidHeaders) {
    const request = {
      headers: {
        authorization,
      },
      agent: {
        agentId: 'stale-agent',
      },
    };

    await assert.rejects(() => guard.canActivate(createContext(request)), {
      status: 401,
      message: 'Invalid agent credentials',
    });

    assert.equal(Object.hasOwn(request, 'agent'), false);
  }

  assert.equal(authenticationCalls, 0);
});

test('agent guard leaves no identity when authentication fails', async () => {
  const guard = new AgentAuthGuard({
    async authenticate() {
      throw new UnauthorizedException('Invalid agent credentials');
    },
  });

  const request = {
    headers: {
      authorization: 'Bearer rejected-key',
    },
    agent: {
      agentId: 'stale-agent',
    },
  };

  await assert.rejects(() => guard.canActivate(createContext(request)), {
    status: 401,
    message: 'Invalid agent credentials',
  });

  assert.equal(Object.hasOwn(request, 'agent'), false);
});

test('agent guard preserves infrastructure errors', async () => {
  const databaseFailure = new Error('Database unavailable');

  const guard = new AgentAuthGuard({
    async authenticate() {
      throw databaseFailure;
    },
  });

  const request = {
    headers: {
      authorization: 'Bearer test-key',
    },
  };

  await assert.rejects(
    () => guard.canActivate(createContext(request)),
    (error) => error === databaseFailure
  );

  assert.equal(Object.hasOwn(request, 'agent'), false);
});
