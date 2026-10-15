# 001 — Open source under AGPL-3.0; self-host anywhere

Date: 2026-10-15 · Status: Accepted

## Context
Gitwork is a SaaS product, not an internal tool. The owner wants a public repo that anyone can
self-host, and a paid hosted version run by Flywheel.

## Decision
- License the code under AGPL-3.0, SPDX `AGPL-3.0-only` (pending owner confirmation, 2026-10-15).
  Without a contributor agreement, a later move to "-or-later" needs every contributor's consent.
- Self-hosters choose where to run it. Gitwork supports Cloudflare Workers and any Node host (Docker).
- Ship a setup wizard. On first run it collects the admin email and SMTP settings, then uses
  GitHub's App manifest flow to create the team's own GitHub App in one click.
- Ship a "Deploy to Cloudflare" button and a `docker-compose.yml`.
- The hosted version uses one public GitHub App that customers install in their orgs.
- No billing in v1. An "Agency" plan with unlimited workspaces comes later.

## Alternatives considered
- **MIT:** lets a competitor host a closed fork. Rejected.
- **Closed source, hosted only:** contradicts the goal.

## Consequences
- A company that hosts a modified Gitwork for others must publish its changes.
- Every platform-specific service needs a portable default (see 004).
