# Security policy

## Report a vulnerability

Do not open a public issue. Report it privately through GitHub:
**Security → Report a vulnerability** on this repository.

Include the affected version or commit, the steps to reproduce, and the impact. We answer within
five working days and tell you when a fix ships. We credit reporters who want credit.

## Scope

In scope: this repository, the Docker image `ghcr.io/flywheelstudio/gitwork`, and the default
configuration. Especially: a Read Only user receiving a hidden item, any bypass of the role checks,
webhook signature bypass, and leaks of stored secrets.

Out of scope: problems that need a compromised instance admin or host, and self-hosted instances
running outdated versions.

## Supported versions

The latest release gets security fixes. Upgrade to it before you report.
