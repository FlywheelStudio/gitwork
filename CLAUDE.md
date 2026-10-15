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

Run from the repo root. pnpm comes from corepack (`corepack enable`).

```bash
pnpm install
pnpm dev            # Node + SQLite file (apps/web/.data/), runs migrations first
pnpm preview        # OpenNext build + local D1 migrations + workerd
pnpm lint           # ESLint: eslint-config-next in apps/web, typescript-eslint in packages/*
pnpm typecheck
pnpm test           # Vitest; the DB contract runs on libsql and on D1 (wrangler getPlatformProxy)
pnpm test:e2e       # Playwright against the Node runtime
pnpm smoke          # scripts/smoke.sh: both runtimes end to end + Worker bundle scan
pnpm db:generate    # drizzle-kit: new migration from packages/db/src/schema.ts
pnpm db:migrate     # apply migrations to the local SQLite file
```

## Codebase map

```
apps/web        Next.js app, /api/v1 REST API, GitHub webhooks
apps/mac        Native macOS app (AppKit + TextKit 2) — Phase 6, not created yet
packages/core   Pure domain logic: role matrix (permissions.ts); later visibility, attribution, markdown
packages/server DB- and auth-aware code: Better Auth factory, services, /api/v1 router, email
packages/db     Drizzle schema + migrations (SQLite dialect), D1 and file drivers, test helpers
docs/           INDEX.md → STATE.md → spec.md, decisions/
```

## Rules

- Every read and write goes through the permission and visibility checks in `packages/core`. Never
  return GitHub data to a client without them. Services load access with
  `requireWorkspaceAccess()` and call `requireCapability()`.
- New `/api/v1` routes go in `packages/server/src/api/routes.ts`, with tests in
  `packages/server/test/api.test.ts` (success, 401, 403, 400).
- DB tests run on both drivers: `describe.each(await allTestDrivers())` from `@gitwork/db/testing`.
- Pages read the request (`getSession()`/`connection()`) before any config, or `next build` fails.
- Webhook handlers verify the signature and are idempotent on the delivery ID.
- The markdown editors must leave untouched lines byte-identical. The round-trip fixture suite
  guards this; never weaken it.
- Platform services go behind the adapters in decision 004. Core code must run on plain Node.
- The DB driver is chosen at build time (`GITWORK_TARGET`, see `apps/web/next.config.ts`). Import the
  database only through `@/server/db`. Never import `@gitwork/db/node` or `/migrate` from app code.
- Use `db.batch()` for atomic writes. Never `db.transaction()`: D1 does not support it.
- pnpm enforces a one-day `minimumReleaseAge`. After any `pnpm add`, check `pnpm-workspace.yaml`
  for a new `minimumReleaseAgeExclude` entry and remove it; pin an older version instead.
- `next dev` rewrites `apps/web/AGENTS.md`. Commit it as is.

## Environment variables

See `.env.example`. Node hosts read `DATABASE_URL`; Cloudflare uses the `DB` binding in
`apps/web/wrangler.jsonc`. Never commit `.env*` files.

## Start here

Read `docs/INDEX.md`, then `docs/STATE.md`, then `docs/spec.md`.
