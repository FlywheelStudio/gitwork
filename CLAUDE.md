# Gitwork

Open-source (AGPL-3.0) project management on top of GitHub. A Next.js web app and a native Mac app
show a GitHub Projects v2 board as list, kanban, and timeline views, and edit each repo's `docs/`
markdown. People without GitHub accounts get role-based access.

## Stack

- **Web:** Next.js (App Router), React, TypeScript, Tailwind CSS, shadcn/ui. Deploys to Cloudflare
  Workers through OpenNext, or to any Node host (decisions 001, 002).
- **Database:** SQLite through Drizzle — D1 on Cloudflare, a SQLite file elsewhere (decision 003).
- **Auth:** Better Auth, magic link first (decision 005).
- **Mac:** native AppKit + TextKit 2, macOS 14+ (decision 013).
- **Tests:** Vitest for unit and integration, Playwright for E2E, XCTest for the Mac app.
- **Package manager:** pnpm.

## Commands

Not scaffolded yet. Phase 0 replaces this section with real `pnpm` commands for dev, build, test,
lint, and typecheck.

## Codebase map (planned)

```
apps/web        Next.js app, /api/v1 REST API, GitHub webhooks
apps/mac        Native macOS app (AppKit + TextKit 2)
packages/core   Permissions, visibility filter, GitHub sync, attribution, markdown round trip
packages/db     Drizzle schema + migrations (SQLite dialect), D1 and file drivers
docs/           INDEX.md → STATE.md → spec.md, decisions/
```

## Rules

- Every read and write goes through the permission and visibility checks in `packages/core`. Never
  return GitHub data to a client without them.
- Webhook handlers verify the signature and are idempotent on the delivery ID.
- The markdown editors must leave untouched lines byte-identical. The round-trip fixture suite
  guards this; never weaken it.
- Platform services go behind the adapters in decision 004. Core code must run on plain Node.

## Environment variables

`.env.example` arrives in Phase 0. Never commit `.env*` files.

## Start here

Read `docs/INDEX.md`, then `docs/STATE.md`, then `docs/spec.md`.
