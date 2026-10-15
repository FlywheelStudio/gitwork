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
- Spike step 2: Next.js renders under `opennextjs-cloudflare preview`. `cacheComponents` (on in
  the create-next-app template) hangs every request under workerd. Turned off.
- pnpm 12 enforces `minimumReleaseAge` (1 day). `pnpm add` of a too-new version silently writes a
  `minimumReleaseAgeExclude` entry to `pnpm-workspace.yaml`. Removed the list; pinned versions older
  than one day instead. Check that file after every `pnpm add`.
- OpenNext 1.20.11 + Next 16.4.x fails at runtime: `Unexpected loadManifest(.../preview-props.json)`.
  1.20.12 adds 16.4 support but was too new for the policy. Pinned Next 16.3.8 + OpenNext 1.20.11.
  Move to 16.4 when OpenNext 1.20.12 passes the age policy.
- Node driver: libsql (`@libsql/client`) instead of better-sqlite3. It is async like D1, supports
  Drizzle `batch()`, and ships prebuilt binaries (no install scripts). `Db` type hides
  `transaction()`; `batch()` is the only atomic write (D1 has no interactive transactions).
- Driver split is build-time: `next.config.ts` aliases `@gitwork/db-runtime` to the D1 or libsql
  runtime based on `GITWORK_TARGET`. The smoke script fails if libsql code reaches the Worker
  bundle; a deliberate wrong-target build produced 24 hits, so the check can fail.
- Migration code lives in `@gitwork/db/migrate`, apart from `@gitwork/db/node`: Turbopack tried to
  bundle `new URL("../migrations", import.meta.url)` as an asset.
- `wrangler d1 migrations apply --local` reads drizzle-kit's `migrations/` folder as written.
- D1 contract test inspects the client behind the `Database` object; swapping in libsql turns it red.
