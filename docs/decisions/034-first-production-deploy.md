# 034 — First production deploy: workers.dev URL, sending domain pending

Date: 2026-11-19 · Status: accepted

## Context

The owner wanted Gitwork running in production, so the GitHub App points at a stable URL and no
tunnel is needed. Production needs a URL (the GitHub App stores it at creation) and a domain on
Cloudflare Email Service for sign-in codes.

## Decision

- **URL:** `https://gitwork.erik-edf.workers.dev` (owner's choice over a custom subdomain).
- **Sending domain:** the owner chose a mail subdomain such as `mail.flywheel.so`. Cloudflare Email
  Service requires the domain to use Cloudflare DNS, and `flywheel.so` is on Namecheap DNS with
  Google Workspace mail. Until a domain on Cloudflare DNS is onboarded, production cannot send
  sign-in codes, so nobody can sign in. `EMAIL_FROM` stays a placeholder.
- **Private deploy config:** the real D1 id lives in `apps/web/wrangler.production.local.jsonc`
  (git-ignored). `WRANGLER_CONFIG` points `pnpm deploy:cf` at it.
- **Env guard:** the OpenNext build bakes `apps/web/.env*` into the Worker. The first build did so
  with the development `.env.local`; it was caught before deploy. `scripts/check-worker-env.sh` now
  blocks `pnpm deploy:cf` when the bundle has baked variables.

## Alternatives considered

- **Move `flywheel.so` DNS to Cloudflare.** Unblocks `mail.flywheel.so`, but risks company email for
  one sender. Not done without the owner's go.
- **A domain already on Cloudflare DNS** (`erikgoins.com`, `ulink.ly`, possibly `gitwork.dev`).
  Works today; the owner has not picked one.
- **Console email on Workers.** Rejected: production auth must not log sign-in codes.

## Consequences

- Production is deployed and healthy (`/api/v1/health` reports `d1`), but sign-in waits on the
  sending domain. Then: set `EMAIL_FROM` in the private config, redeploy, sign in, `/setup`.
- Rollback: `wrangler delete gitwork` and `wrangler d1 delete gitwork`.
