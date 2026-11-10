# Self-host Gitwork

Gitwork runs on any Docker host (a SQLite file on a volume) or on Cloudflare Workers (D1). Pick one.
Either way you need four things:

1. **A public https URL.** GitHub sends webhooks to it, and sign-in emails link to it.
2. **Email for sign-in codes.** SMTP on Docker; Cloudflare Email Service on Workers.
3. **Your admin email** in `INSTANCE_ADMIN_EMAILS`. That person opens `/setup`.
4. **A GitHub organization** where an owner can install the GitHub App that `/setup` creates.

## Docker

```bash
git clone https://github.com/FlywheelStudio/gitwork && cd gitwork
cp .env.example .env
```

Edit `.env`:

| Variable | Value |
|---|---|
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32`. Keep it: changing it locks out the stored GitHub App and linked accounts. |
| `BETTER_AUTH_URL` | Your public URL, for example `https://gitwork.example.com`. |
| `INSTANCE_ADMIN_EMAILS` | Your email. Commas separate several. |
| `EMAIL_TRANSPORT` | `smtp` |
| `SMTP_URL` | `smtp://user:password@smtp.example.com:587` (or `smtps://…:465`). |
| `EMAIL_FROM` | `Gitwork <no-reply@example.com>`. Use a domain your SMTP provider may send from. |

Start it. Pick one:

```bash
docker compose up -d                                         # port 3000, behind your own proxy
GITWORK_DOMAIN=gitwork.example.com docker compose --profile caddy up -d   # Caddy gets a TLS certificate
```

With the Caddy profile, also set `TRUSTED_IP_HEADER=x-real-ip` in `.env` (Caddy overwrites that
header). Behind another proxy, set it only if that proxy always overwrites the header.

The container applies database migrations on every start, and **refuses to start** on a
configuration error. `docker compose logs gitwork` names the variable.

Then open your URL, sign in with your admin email, and go to **/setup**.

### Upgrade

```bash
docker compose pull && docker compose up -d
```

Migrations run on start. Read the [release notes](https://github.com/FlywheelStudio/gitwork/releases)
first. Pin a version with `GITWORK_TAG=0.1.0` in `.env`.

### Back up

The database is one SQLite file on the `gitwork-data` volume. `backup.mjs` copies it with SQLite's
`VACUUM INTO`, which is safe while Gitwork runs:

```bash
docker compose exec gitwork node backup.mjs /data/backup-$(date +%F).sqlite
docker compose cp gitwork:/data/backup-$(date +%F).sqlite .
```

Run it daily from cron. To restore, stop Gitwork, replace `gitwork.sqlite` with the backup, and
start it. Also keep `BETTER_AUTH_SECRET`: a backup without it cannot decrypt the stored GitHub App.

## Cloudflare Workers

Needs the **Workers Paid plan** (decision 022): the Worker is over the Free plan's 3 MiB.

```bash
git clone https://github.com/FlywheelStudio/gitwork && cd gitwork
corepack enable && pnpm install
cd apps/web
pnpm exec wrangler d1 create gitwork        # paste the database_id into wrangler.jsonc
```

In `apps/web/wrangler.jsonc`, set `EMAIL_FROM` to an address on a domain you onboarded to
[Cloudflare Email Service](https://developers.cloudflare.com/email-service/). Then set the secrets
and deploy:

```bash
pnpm exec wrangler secret put BETTER_AUTH_SECRET     # openssl rand -base64 32
pnpm exec wrangler secret put BETTER_AUTH_URL        # https://gitwork.<you>.workers.dev or your domain
pnpm exec wrangler secret put INSTANCE_ADMIN_EMAILS
cd ../.. && pnpm deploy:cf                           # build, migrate D1, deploy
```

`pnpm deploy:cf` runs D1 migrations before each deploy, so upgrades are `git pull` and
`pnpm deploy:cf`. D1 keeps 30 days of point-in-time history (Time Travel) for restores. Reconcile
runs from the Cron Trigger in `wrangler.jsonc`.

If you rename the Worker, change `services[0].service` in `wrangler.jsonc` to the new name too.

## Any other Node host

Build with `GITWORK_STANDALONE=1 pnpm --filter @gitwork/web build`, or run the Docker image. Set the
same variables as for Docker, plus `DATABASE_URL=file:/path/to/gitwork.sqlite` on a persistent disk
and `GITWORK_MIGRATIONS_DIR` pointing at `packages/db/migrations`. One instance per SQLite file.

## After the first start

1. Sign in with your admin email. The code arrives by email.
2. **/setup → Create GitHub App.** GitHub asks you to confirm, then returns you to Gitwork. The App
   is private to your organization. Its webhook URL is `BETTER_AUTH_URL/api/github/webhook`.
3. Install the App on your organization (an org owner must approve). Choose the repos.
4. Choose who may create accounts (setup step 3). Invites always work.
5. Create a workspace, link your GitHub account (Settings), then link a board and repos.
6. **/setup/health** shows the configuration, the GitHub App, the last webhook, and the last
   reconcile.

## Troubleshooting

| Symptom | Cause |
|---|---|
| Container exits at start | A configuration error. `docker compose logs gitwork` names it. |
| No sign-in email | `SMTP_URL` or `EMAIL_FROM` is wrong. Check the SMTP provider's log. |
| "Last webhook: none" on /setup/health | GitHub cannot reach `BETTER_AUTH_URL`. Check the App's "Recent deliveries" on GitHub. |
| "Stored credentials cannot be decrypted" | `BETTER_AUTH_SECRET` changed. Restore it, or replace the App in /setup. |
| Tasks are stale | Check "Last reconcile" on /setup/health. Rate limits show there. |
