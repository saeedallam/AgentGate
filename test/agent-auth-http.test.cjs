require('reflect-metadata');

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  Controller,
  Module,
  Post,
  Req,
  UseGuards,
  UnauthorizedException,
} = require('@nestjs/common');

const { NestFactory } = require('@nestjs/core');
const { FastifyAdapter } = require('@nestjs/platform-fastify');

const {
  AgentAuthGuard,
} = require('../dist/agent-credentials/agent-auth.guard.js');

const {
  AgentAuthenticationService,
} = require('../dist/agent-credentials/agent-authentication.service.js');

test('agent guard protects HTTP requests and supplies trusted identity', async () => {
  const verifiedIdentity = {
    agentId: 'verified-agent',
    organizationId: 'verified-organization',
    credentialId: 'verified-credential',
  };

  let controllerCalls = 0;
  const receivedKeys = [];

  const authentication = {
    async authenticate(apiKey) {
      receivedKeys.push(apiKey);

      if (apiKey === 'infrastructure-failure') {
        throw new Error('Database unavailable');
      }

      if (apiKey !== 'accepted-test-key') {
        throw new UnauthorizedException('Invalid agent credentials');
      }

      return { ...verifiedIdentity };
    },
  };

  class ProbeController {
    inspect(request) {
      controllerCalls += 1;
      return request.agent;
    }
  }

  // Apply decorators manually because this file is plain JavaScript.
  Controller('__test/agent-auth')(ProbeController);
  UseGuards(AgentAuthGuard)(ProbeController);

  Post()(
    ProbeController.prototype,
    'inspect',
    Object.getOwnPropertyDescriptor(ProbeController.prototype, 'inspect')
  );

  Req()(ProbeController.prototype, 'inspect', 0);

  class ProbeModule {}

  Module({
    controllers: [ProbeController],
    providers: [
      AgentAuthGuard,
      {
        provide: AgentAuthenticationService,
        useValue: authentication,
      },
    ],
  })(ProbeModule);

  const app = await NestFactory.create(
    ProbeModule,
    new FastifyAdapter({ logger: false }),
    { logger: false }
  );

  const url = '/__test/agent-auth';

  try {
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    // Invalid headers must fail before authentication or controller.
    for (const headers of [
      {},
      { authorization: 'Basic something' },
      { authorization: 'Bearer' },
      { authorization: 'Bearer key extra' },
    ]) {
      const response = await app.inject({
        method: 'POST',
        url,
        headers,
        payload: {},
      });

      assert.equal(response.statusCode, 401);
      assert.equal(response.json().message, 'Invalid agent credentials');
    }

    assert.equal(receivedKeys.length, 0);
    assert.equal(controllerCalls, 0);

    // A rejected credential must not reach the controller.
    const rejected = await app.inject({
      method: 'POST',
      url,
      headers: {
        authorization: 'Bearer rejected-test-key',
      },
      payload: {},
    });

    assert.equal(rejected.statusCode, 401);
    assert.equal(rejected.json().message, 'Invalid agent credentials');
    assert.deepEqual(receivedKeys, ['rejected-test-key']);
    assert.equal(controllerCalls, 0);

    // Identity in the body must not replace authenticated identity.
    const accepted = await app.inject({
      method: 'POST',
      url,
      headers: {
        authorization: 'Bearer accepted-test-key',
      },
      payload: {
        organizationId: 'spoofed-organization',
        agent: {
          agentId: 'spoofed-agent',
          organizationId: 'spoofed-organization',
          credentialId: 'spoofed-credential',
        },
      },
    });

    assert.equal(accepted.statusCode, 201);
    assert.deepEqual(accepted.json(), verifiedIdentity);
    assert.equal(controllerCalls, 1);

    // The scheme is case-insensitive; the key is passed unchanged.
    const lowercaseScheme = await app.inject({
      method: 'POST',
      url,
      headers: {
        authorization: 'bearer accepted-test-key',
      },
      payload: {},
    });

    assert.equal(lowercaseScheme.statusCode, 201);
    assert.deepEqual(lowercaseScheme.json(), verifiedIdentity);
    assert.equal(receivedKeys[receivedKeys.length - 1], 'accepted-test-key');
    assert.equal(controllerCalls, 2);

    // Infrastructure failures remain server errors.
    const infrastructureFailure = await app.inject({
      method: 'POST',
      url,
      headers: {
        authorization: 'Bearer infrastructure-failure',
      },
      payload: {},
    });

    assert.equal(infrastructureFailure.statusCode, 500);
    assert.equal(controllerCalls, 2);
    assert.equal(
      infrastructureFailure.body.includes('Database unavailable'),
      false
    );

    // A later unauthenticated request must still be rejected.
    const anonymous = await app.inject({
      method: 'POST',
      url,
      payload: {},
    });

    assert.equal(anonymous.statusCode, 401);
    assert.equal(controllerCalls, 2);
  } finally {
    await app.close();
  }
});
