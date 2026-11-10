# 023 — Self-host release scope

Date: 2026-11-10 · Status: Accepted (owner) · Builds on 001, 022

## Context
The owner asked to make Gitwork "possible to host open source". Two readings: anyone can run their
own copy, or open-source maintainers can show public boards.

## Decision
- The goal is a self-host release: a Docker image on GHCR, `docker-compose.yml`, a Deploy to
  Cloudflare button, a self-host guide, boot-time config checks, an admin health page, and repo
  hygiene (README, CONTRIBUTING, SECURITY, templates, CHANGELOG, semver).
- Public, no-sign-in boards for open-source maintainers are a separate, later item.

## Alternatives considered
- **Public boards now:** needs anonymous reads and personal-account repos (decision 006). Larger,
  and not what most self-hosters need first.

## Consequences
- Roadmap Track A. The live GitHub check gates the release.
