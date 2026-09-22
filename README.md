# AgentGate

Runtime authorization gateway for AI agents. Modular NestJS monolith.
This snapshot implements **milestone 1, step 1 only**.

## Local setup
Requires Node 24 and Docker Compose v2.

```sh
cp .env.example .env
npm ci
npm run prisma:generate
docker compose up -d postgres
npm run build
npm start
```

GET http://localhost:3000/health returns 200 when the process responds.
GET http://localhost:3000/health/ready queries PostgreSQL and returns 200 or a
sanitized 503. Readiness is intentionally separate from liveness.

For the containerized API: `docker compose --profile app up --build -d`.
Compose is for local development; credentials are examples. If changing credentials,
keep DATABASE_URL in sync and percent-encode URL-special characters. Do not commit .env.
Existing database volumes retain their original credentials.

```sh
npm run prisma:validate
npm test
npm run lint
```

Tests use Node's test runner and Fastify injection. Database outcomes are mocked;
they do not prove a real PostgreSQL connection or Docker image works.
No business tables or migrations exist yet. The Prisma service manages the adapter
and shutdown; it is not a repository abstraction. Future tenant access must be scoped.
Fastify uses its built-in Pino logger with sensitive request data omitted.
Nest's default exception handling suffices for this slice; domain error mapping,
Swagger and authentication/rate limiting arrive with the relevant API slices.

## Next slices
1. User, Organization, OrganizationMember and migration; tenant constraints and tests.
2. Register/login with Argon2, JWT, validation and rate limiting; verified membership.
3. Agents and hashed credentials, one-time key output, suspension and authentication guard.

Redis and BullMQ will be introduced with asynchronous execution. Read AGENTS.md
before implementing changes. Nest 11 is explicitly selected as a conservative
baseline, not claimed as the latest release; package-lock.json pins resolved versions.
