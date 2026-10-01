require('reflect-metadata');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { ConfigService } = require('@nestjs/config');

const {
  PrismaService,
} = require('../dist/infrastructure/database/prisma.service.js');

const {
  AgentKeyService,
} = require('../dist/agent-credentials/agent-key.service.js');

const {
  AgentAuthenticationService,
} = require('../dist/agent-credentials/agent-authentication.service.js');

const databaseUrl = process.env.TEST_DATABASE_URL;

if (!databaseUrl) {
  throw new Error('TEST_DATABASE_URL is required');
}

if (new URL(databaseUrl).pathname !== '/agentgate_test') {
  throw new Error('Integration tests require agentgate_test');
}

test('agent authentication verifies keys, tenant identity, revocation and suspension', async () => {
  const prisma = new PrismaService(
    new ConfigService({
      DATABASE_URL: databaseUrl,
    })
  );

  const keys = new AgentKeyService();
  const authentication = new AgentAuthenticationService(prisma, keys);

  const organizationA = randomUUID();
  const organizationB = randomUUID();
  const agentA = randomUUID();
  const agentB = randomUUID();

  const organizationIds = [organizationA, organizationB];

  const keyA = keys.generate();
  const keyB = keys.generate();

  const rejection = {
    status: 401,
    message: 'Invalid agent credentials',
  };

  let testFailed = false;

  try {
    await prisma.organization.createMany({
      data: [
        {
          id: organizationA,
          name: 'Agent authentication A',
        },
        {
          id: organizationB,
          name: 'Agent authentication B',
        },
      ],
    });

    await prisma.agent.createMany({
      data: [
        {
          id: agentA,
          organizationId: organizationA,
          name: 'support-agent',
        },
        {
          id: agentB,
          organizationId: organizationB,
          name: 'support-agent',
        },
      ],
    });

    const credentialA = await prisma.agentCredential.create({
      data: {
        organizationId: organizationA,
        agentId: agentA,
        keyPrefix: keyA.keyPrefix,
        keyHash: keyA.keyHash,
      },
    });

    const credentialB = await prisma.agentCredential.create({
      data: {
        organizationId: organizationB,
        agentId: agentB,
        keyPrefix: keyB.keyPrefix,
        keyHash: keyB.keyHash,
      },
    });

    // Identity comes from the credential's database relationship.
    assert.deepEqual(await authentication.authenticate(keyA.apiKey), {
      agentId: agentA,
      organizationId: organizationA,
      credentialId: credentialA.id,
    });

    assert.deepEqual(await authentication.authenticate(keyB.apiKey), {
      agentId: agentB,
      organizationId: organizationB,
      credentialId: credentialB.id,
    });

    // Malformed inputs all receive the same rejection.
    for (const input of [undefined, null, '', 'invalid-key', 123]) {
      await assert.rejects(() => authentication.authenticate(input), rejection);
    }

    // Well-formed key with no matching database record.
    const unknownKey = keys.generate();

    await assert.rejects(
      () => authentication.authenticate(unknownKey.apiKey),
      rejection
    );

    // Correct prefix, but one changed character in the secret.
    const lastCharacter = keyA.apiKey.slice(-1);
    const replacement = lastCharacter === 'a' ? 'b' : 'a';

    const wrongSecret = keyA.apiKey.slice(0, -1) + replacement;

    await assert.rejects(
      () => authentication.authenticate(wrongSecret),
      rejection
    );

    // Revocation must take effect on the next authentication call.
    await prisma.agentCredential.update({
      where: {
        id: credentialA.id,
      },
      data: {
        revokedAt: new Date(),
      },
    });

    await assert.rejects(
      () => authentication.authenticate(keyA.apiKey),
      rejection
    );

    // Revoking A must not affect another tenant's credential.
    assert.deepEqual(await authentication.authenticate(keyB.apiKey), {
      agentId: agentB,
      organizationId: organizationB,
      credentialId: credentialB.id,
    });

    // An unrevoked credential must fail when its agent is suspended.
    await prisma.agent.update({
      where: {
        id: agentB,
      },
      data: {
        status: 'SUSPENDED',
      },
    });

    await assert.rejects(
      () => authentication.authenticate(keyB.apiKey),
      rejection
    );
  } catch (error) {
    testFailed = true;
    throw error;
  } finally {
    try {
      await prisma.$transaction([
        prisma.agentCredential.deleteMany({
          where: {
            organizationId: {
              in: organizationIds,
            },
          },
        }),

        prisma.agent.deleteMany({
          where: {
            organizationId: {
              in: organizationIds,
            },
          },
        }),

        prisma.organization.deleteMany({
          where: {
            id: {
              in: organizationIds,
            },
          },
        }),
      ]);
    } catch (cleanupError) {
      if (!testFailed) {
        throw cleanupError;
      }

      console.error('Test cleanup also failed:', cleanupError);
    } finally {
      await prisma.$disconnect();
    }
  }
});
