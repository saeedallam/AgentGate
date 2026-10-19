# Dependency maintenance

## Security update — 2026-10-15

The previous lockfile reported six affected dependency entries (one moderate and
five high). Some entries describe parents of a vulnerable package, not six
independent application exploits. Audit results do not prove exploitability in
every route; they still require dependency review.

Keep NestJS 11.2.5 and Prisma/client/adapter 7.10.0 aligned. Temporary, exact,
parent-scoped npm overrides select the following dependencies:

| Parent | Dependency | Previous | Selected |
| --- | --- | --- | --- |
| `@nestjs/platform-fastify` | `fastify` | 5.11.3 | 5.12.7 |
| `@prisma/config` | `deepmerge-ts` | 7.1.5 | 8.0.2 |
| `prisma` | `mysql2` | 3.15.3 | 3.24.6 |

This avoids the audit command's suggested Prisma downgrade or Nest major upgrade.
Do not add Fastify as an unused direct dependency: it must replace the version
actually resolved by Nest's adapter. `npm ls` should identify these as overridden.

The deepmerge override crosses a major boundary. Version 8 changes Map merging,
some TypeScript utility types and mutation behavior. Prisma 7.10's config loader
dynamically imports `deepmerge` as its c12 merger. AgentGate's config uses ordinary
records and strings, not Maps or these utility types. Validate that actual config,
generate the client and apply migrations in tests; do not infer compatibility
from the absence of an audit warning. MySQL2 is pulled in by Prisma tooling;
AgentGate uses PostgreSQL and does not test MySQL connections.

Remove each override once its parent natively requires a fixed compatible version,
then regenerate the lockfile, audit and run the checks below. Do not silently
retain overrides across future parent major upgrades.

References:

- [Fastify security advisories](https://github.com/fastify/fastify/security/advisories)
- [Deepmerge v8 changes](https://github.com/RebeccaStevens/deepmerge-ts/releases/tag/v8.0.0)
- [MySQL2 security advisories](https://github.com/sidorares/node-mysql2/security/advisories)

## Repeatable checks

Use Node 24.19.0 and the committed package-lock.json. Run:

```sh
npm ci
npm run audit:dependencies
npm run prisma:validate
npm run prisma:generate
npm test
npm run lint
```

The backend workflow also applies migrations to a fresh PostgreSQL 17 database and
runs integration/concurrency suites, including the actual MCP subprocess. Ordinary
tests alone do not verify database behavior. No new schema migration is needed
for this dependency update. See [verification](verification.md) for run evidence.

The audit checks all dependencies, including development tools, and blocks moderate
or higher advisories. A registry failure is not a successful audit. Do not suppress
advisories or use `--force` to make CI green. Dependabot opens update PRs for review;
there is no automatic merge or production deployment configured.

## Windows

1. Install Node 24.19.0 and reopen CMD. Check `node -v` and `npm -v`.
2. Pull the update, preserving unrelated local changes, then run `npm ci`.
3. If Windows Application Control blocks the Argon2 native binary, do not disable
   the policy. On an authorized development machine with Python and Visual Studio
   C++ Build Tools installed, rebuild and verify loading:

```cmd
npm rebuild argon2 --build-from-source
node -e "require('argon2'); console.log('argon2 loaded')"
```

If loading remains blocked, ask the device administrator to approve the developer
tooling. A local build is not a guarantee that every policy will allow it.

Use a separate CMD window for database tests. Set TEST_DATABASE_URL to the dedicated
`agentgate_test` database and DATABASE_URL to that same URL for migrations. Do not
start the normal development application from that test-configured window.

`.gitattributes` specifies LF for source/configuration and CRLF for Windows command
scripts. No bulk renormalization or deletion of existing local changes is needed.

### Swagger documentation (2026-10-19)

`@nestjs/swagger` 11.4.7 and `@fastify/static` 10.1.6 satisfy the installed Nest 11
platform's peer requirements. A parent-scoped `@nestjs/swagger -> js-yaml: 5.4.1`
override replaces its vulnerable pinned 5.4.0 dependency (GHSA-r3ph-w7gj-g6xm).
Review/remove this override when a compatible Swagger release includes the patch.
No Nest major upgrade or force-audit fix is used.
