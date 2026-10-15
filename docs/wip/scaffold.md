# WIP — Phase 0: Scaffold

Branch: `feature/scaffold`

## Goal
Prove the stack before feature work. `pnpm dev` runs on Node with a SQLite file, and the same app
runs in `wrangler dev` (workerd) with D1. CI runs lint, typecheck, unit tests on both drivers, the
Cloudflare build, and an E2E smoke test.

## Approach
- pnpm workspace: `apps/web`, `packages/core`, `packages/db`. (`apps/mac` starts in Phase 6.)
- `packages/db`: Drizzle schema (SQLite dialect), drizzle-kit migrations, two entry points —
  `@gitwork/db/d1` and `@gitwork/db/node` — that return the same `Db` type.
- First table: `instance_settings` (key/value). The setup wizard (Phase 2) uses it.
- `apps/web`: Next.js App Router, OpenNext Cloudflare adapter, `GET /api/v1/health` reports the
  driver and proves a DB round trip.
- Driver choice: `DB_DRIVER` env var. `sqlite` (default) for Node; `d1` set in `wrangler.jsonc`.
- Tests: Vitest projects per package. DB tests run against better-sqlite3 in memory **and** a real
  D1 through Miniflare. Playwright smoke test against `next start`.
- `LICENSE` (AGPL-3.0), `README.md`, `.env.example`, `.github/workflows/ci.yml`.

## Files expected to change
Root config, `apps/web/**`, `packages/core/**`, `packages/db/**`, `CLAUDE.md` (commands),
`docs/STATE.md`, `docs/INDEX.md`.

## Open questions
- Does OpenNext keep `better-sqlite3` (native) out of the Worker bundle? If not, stub it in the
  Cloudflare build.

## Build log
- 2026-10-15: Branch created. pnpm runs through corepack (not installed globally).
