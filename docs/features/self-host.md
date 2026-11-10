# Self-host release — Docker, config check, health page, release pipeline

Shipped 2026-11-10 (roadmap Track A). Branch `feature/self-host`. Decisions 001, 019, 022, 023, 024.

## What it does
- **Docker:** `docker compose up -d` runs Gitwork with a SQLite file on a named volume. An optional
  `caddy` profile gets a TLS certificate. The image applies migrations at start and refuses to start
  on a configuration error.
- **Config check:** every production start on Node logs each problem by variable name. The page
  `/setup/health` shows the same list to instance admins.
- **Health page:** `/setup/health` (instance admins): version, runtime, database driver,
  configuration, GitHub App, installations, last webhook, last reconcile. Database reads only.
- **Backup:** `node backup.mjs <file>` inside the container: SQLite `VACUUM INTO`, safe while running.
- **Cloudflare:** `pnpm deploy:cf` builds, applies D1 migrations, and deploys.
- **Release:** a `v*.*.*` tag publishes `ghcr.io/flywheelstudio/gitwork` (amd64 + arm64) and a
  GitHub Release with generated notes.
- **Repo:** README, CONTRIBUTING (DCO), SECURITY, CODE_OF_CONDUCT, CHANGELOG, issue and PR
  templates, a DCO check on pull requests, and the self-host guide (`docs/self-host/`).

## How it works

| File | Role |
|---|---|
| `Dockerfile` | Two stages: `pnpm install` + standalone `next build`, then `node:22-slim` as user `node`. Sets `DATABASE_URL`, `GITWORK_MIGRATIONS_DIR`, `GITWORK_FAIL_ON_CONFIG_ERROR`. |
| `apps/web/next.config.ts` | `GITWORK_STANDALONE=1` turns on `output: "standalone"`, traced from the repo root. Off by default, so `pnpm start` and OpenNext are unchanged. |
| `packages/server/src/config-check.ts` | `checkConfig(env, runtime)`: pure, names variables only. `instanceHealth()`: the health page's data. |
| `apps/web/src/server/runtime/runtime.node.ts` | `bootNode()`: config check, optional exit, migrations. The Worker runtime's `bootNode()` is a no-op. |
| `apps/web/src/instrumentation.ts` | Awaits `bootNode()` before the server takes requests, then starts the reconcile timer. |
| `apps/web/src/app/setup/health/page.tsx` | The health page. |
| `scripts/backup.mjs` | Finds `@libsql/client` under the standalone `node_modules/.pnpm` and runs `VACUUM INTO`. |
| `scripts/selfhost-check.sh` | The exit check minus GitHub: health on sqlite, email-code sign-in, `/setup` and `/setup/health` as admin. |
| `scripts/check-dco.sh` | Every non-merge commit in the PR carries `Signed-off-by:` matching its author. |
| `.github/workflows/ci.yml` (`docker` job) | Builds the image, runs the self-host check and a backup, and proves the image refuses to start unconfigured. |
| `.github/workflows/release.yml` | Tag → multi-arch image on GHCR + GitHub Release. |

**Config rules.** Errors: missing or short (< 32) `BETTER_AUTH_SECRET`; missing or non-http(s)
`BETTER_AUTH_URL`; empty `INSTANCE_ADMIN_EMAILS`; an email transport that cannot send in production
(`smtp` without `SMTP_URL`, `console`, nothing; anything but `cloudflare` on Workers); a partial set
of the five GitHub App variables. Warnings: plain http on a public host, `outbox`, no `EMAIL_FROM`,
no `DATABASE_URL`, an unknown `GITWORK_SCHEDULER`.

## Testing
- `config-check.test.ts`: every rule, both runtimes, values never in messages; `instanceHealth` on
  both drivers (fresh database; installations without deleted ones; newest webhook; last run).
- E2E `setup.spec.ts`: an admin opens `/setup/health`, sees six rows and the outbox warning, and no
  secret value; a non-admin gets 404.
- Local run of the standalone server laid out like the image: unconfigured start exits 1 and names
  three variables; configured start migrates a fresh database and passes `selfhost-check.sh`;
  `backup.mjs` writes a copy and refuses to overwrite it.
- `scripts/check-dco.sh` fails on the unsigned Phase 3 commits (proven red).
- `pnpm smoke` now fails above 10 MiB gzipped; today 3,496 KiB.
- **Not run locally:** `docker build` (no Docker on the dev machine). The CI `docker` job is the
  first real build of the image.

## Gotchas
- **iCloud Drive copies files** (`name 2.ext`) in a repo under `~/Documents`, including inside
  `.next` and `.git`. A copied migration runs twice on D1. `scripts/check-repo.sh` (PR #5) guards
  tracked files; keep the repo out of iCloud.
- **Standalone hides `@libsql/client`** under `node_modules/.pnpm/`. `backup.mjs` searches for it;
  a one-line `require('@libsql/client')` fails.
- **E2E outbox race:** a second sign-in for the same email can read the first code. `signInCode(email,
  emailCount(email))` waits for a newer email.
- **Deploy to Cloudflare button: not shipped.** Cloudflare's button wants the app isolated in one
  folder; Gitwork's Worker depends on workspace packages. Proving it needs a real deploy to a
  Cloudflare account (owner approval). `pnpm deploy:cf` is the documented path.
- **Private vulnerability reporting** must be turned on in the repo settings for SECURITY.md's link
  to work (owner action).
