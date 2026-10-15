# Security policy

AgentGate is currently a Fake Commerce demonstration and development project,
not a production-certified payment or security service. Security controls apply
only to actions routed through AgentGate. Only the current `main` branch is
maintained; there is no support or incident-response SLA.

## Reporting a vulnerability

Use the repository's **Security → Report a vulnerability** option if GitHub
private vulnerability reporting is enabled. Do not put credentials, customer
data, exploit payloads or detailed vulnerability reports in public issues.

If that option is unavailable, open an issue containing only a request for a
private security contact, without vulnerability details. Wait for the maintainer
to establish a private channel before sharing the report. This file does not
enable GitHub private reporting or establish a monitored email address.

A private report should include the affected commit, prerequisites, a minimal
reproduction with synthetic data, the security boundary affected and expected
versus actual behavior. Test only against systems you control or are authorized
to test. Never send real API keys, passwords or access tokens.

## Dependency maintenance

Use the Node version in `.nvmrc` and `npm ci` with the committed lockfile.
`npm run audit:dependencies` checks development and runtime dependencies and
fails at moderate severity or above. The backend workflow runs this check.
Registry availability and newly published advisories can affect its result.
Dependabot proposes updates; it does not automatically approve or merge them.

Temporary scoped overrides and their compatibility checks are documented in
[dependency maintenance](docs/dependency-maintenance.md). Do not use
`npm audit fix --force` as a substitute for reviewing framework compatibility.

An audit with zero reported vulnerabilities is a point-in-time advisory check,
not a guarantee that the application is secure. See
[roadmap boundaries](docs/project-roadmap-status.md) for deferred production work.
