# Security policy

## Supported versions

Security fixes are developed for the current 4.x line and the latest published
stable release. Older lines may receive a fix only when an explicit maintenance
commitment is announced; do not assume they are supported.

## Reporting a vulnerability

Do not disclose vulnerability details, credentials, session data, licensed
documents or exploit material in a public issue.

Use GitHub Private Vulnerability Reporting through **Security → Advisories →
Report a vulnerability** in the public repository. That channel was enabled
and read back through GitHub's API during the 2026-09-01 release audit. Because
it remains an external repository setting, stop if the private reporting flow
is unavailable. A public issue may ask only for a private contact route; include
no vulnerability detail or sensitive material in that issue. This policy
intentionally does not invent or publish an unverified security email address.

Include, where safe:

- affected version, package or commit;
- affected provider, MCP tool, cache service or build/release component;
- prerequisites and the smallest reproducible sequence;
- expected and observed security impact;
- whether credentials, licensed content or personal data may have been exposed;
- suggested remediation or a patch, if available.

Do not send real provider passwords, bearer tokens, cookies or licensed document
content through the reporting channel. Use redacted values and a minimal
synthetic proof of concept. If authentic evidence is indispensable, stop and
request an approved private transfer path from the repository owner first.

## Scope

Reports about this project's source, npm package, MCPB bundles, generated public
distribution, private-cache service, CI/release definitions and documented
deployment defaults are in scope. Availability or behavior of a third-party
legal portal is normally outside this project's control, unless the issue is in
how this project handles that portal.

Receipt, triage and disclosure timing will be coordinated privately according
to impact and remediation complexity. No bug-bounty payment or fixed response
SLA is promised by this policy.
