# Changelog

All notable changes. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versions follow [Semantic Versioning](https://semver.org/). Before 1.0.0, a minor version may
break things; the notes say how to upgrade.

## Unreleased

### Added
- Self-hosting: Docker image (`ghcr.io/flywheelstudio/gitwork`), `docker-compose.yml` with an
  optional Caddy TLS profile, migrations on start, a configuration check that stops a bad deploy at
  boot, an online backup script, and a self-host guide.
- `/setup/health` for instance admins: configuration, GitHub App, last webhook, last reconcile.
- `pnpm deploy:cf`: build, migrate D1, and deploy to Cloudflare Workers.
- Tasks on web: list, kanban, and timeline views of a GitHub Projects v2 board; task edits.
- Identity: email-code sign-in, accounts, workspaces, four roles, invites, GitHub account link.
- GitHub App: setup wizard, webhooks, cache, 15-minute reconcile.
