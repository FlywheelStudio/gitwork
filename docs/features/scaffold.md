# Scaffold — monorepo, two runtimes, one database type

Shipped 2026-10-15 (Phase 0). Branch `feature/scaffold`.

## What it does
Sets up the stack every later phase builds on. Decision 016 records the lasting choices. The same Next.js app runs on Node with a SQLite file
and on Cloudflare Workers with D1. `GET /api/v1/health` proves a database round trip and reports
which driver served it.

## How it works

**Layout:** pnpm workspace — `apps/web` (Next.js), `packages/core` (domain logic; only the
`APP_NAME` constant and `botAttribution()` so far), `packages/db` (Drizzle schema, migrations,
drivers). Packages export TypeScript source; `next.config.ts` lists them in `transpilePackages`.

**Database type:** `packages/db/src/types.ts` defines `Db`: Drizzle's async SQLite database with
`transaction()` removed and D1's `batch()` added. Both drivers satisfy it:

| Entry point | Driver | Used by |
|---|---|---|
| `@gitwork/db/d1` → `openD1(binding)` | D1 | Worker runtime |
| `@gitwork/db/node` → `openSqlite(url)` | libsql (`file:` or `:memory:`) | Node runtime, tests |
| `@gitwork/db/migrate` → `migrateSqlite()` | libsql migrator | `pnpm db:migrate`, tests |

**Build-time driver split:** app code imports `getDatabase()` from `@/server/db`, which re-exports
`@gitwork/db-runtime`. `next.config.ts` aliases that name to `runtime.workerd.ts` when
`GITWORK_TARGET=cloudflare` (set by `pnpm cf:build`) and to `runtime.node.ts` otherwise. So the
Worker bundle never contains libsql.

**Migrations:** `pnpm db:generate` (drizzle-kit) writes `packages/db/migrations/`. Node hosts apply
them with `pnpm db:migrate` (runs before `pnpm dev`). Cloudflare applies the same folder with
`wrangler d1 migrations apply DB` (`migrations_dir` in `wrangler.jsonc`).

**Schema:** one table, `instance_settings` (key/value), for the Phase 2 setup wizard.

## Testing
- `pnpm test` — Vitest. `packages/db/test/contract.ts` runs on libsql (`:memory:`) and on a real D1
  through wrangler's `getPlatformProxy`: round trip, batch, batch rollback on failure. The D1 suite
  asserts the client behind the `Database` is D1 (proven to fail when libsql is swapped in).
- `pnpm test:e2e` — Playwright against `next start`.
- `pnpm smoke` — `scripts/smoke.sh` builds and serves both runtimes and checks the health driver.
  It refuses to start if port 3123 or 8799 is busy, so a stale server cannot answer for a new build.
  It calls `scripts/scan-worker-bundle.sh`, which fails on libsql code or a `.node` file in the
  Worker bundle. Each check was proven to fail: a wrong-target build (24 libsql hits), probe
  directories with libsql code and with a `.node` file, and a held port.
- CI (`.github/workflows/ci.yml`) runs all of the above. **Not yet run on GitHub: the repo has no
  remote.** The full workflow sequence passes in a fresh local clone (2026-10-15).

## Gotchas
- **`cacheComponents` hangs every request under workerd** (its `setTimeout` dependency). Keep it off.
  Covered by `pnpm smoke`.
- **Never use `db.transaction()`.** D1 has no interactive transactions. Use `db.batch()`. The `Db`
  type omits `transaction` so the compiler blocks it. Covered by the batch rollback test.
- **Never import `@gitwork/db/node` or `/migrate` from app code.** It breaks the driver split.
  Covered by the smoke bundle scan.
- **Migration code stays out of `@gitwork/db/node`.** Turbopack tries to bundle
  `new URL("../migrations", import.meta.url)` as an asset and fails the build.
- **pnpm `minimumReleaseAge` (1 day).** `pnpm add` of a newer version silently adds a
  `minimumReleaseAgeExclude` entry to `pnpm-workspace.yaml`. Remove it and pin an older version.
- **Version pin:** Next 16.3.8 + OpenNext 1.20.11. OpenNext 1.20.11 fails on Next 16.4.x at runtime
  (`Unexpected loadManifest(.../preview-props.json)`). OpenNext 1.20.12 requires Next ≥16.4.1 on
  the 16.x line. No GitHub advisory affects Next 16.3.8 (checked 2026-10-15; the Oct 7 advisories
  are fixed in 16.3.8). Upgrade both together once OpenNext 1.20.12 passes the age policy
  (after 2026-10-16 07:53 UTC), then run `pnpm smoke`.
- **`pnpm audit`:** one high finding, `glob` CLI command injection (GHSA-5j98-mcp5-4vw2), via
  OpenNext's build tooling. It needs the `glob` CLI's `-c` flag; Gitwork never runs it.
- **`apps/web/cloudflare-env.d.ts` is generated** by `pnpm --filter @gitwork/web cf:typegen`.
  Regenerate after changing `wrangler.jsonc`; do not edit.
