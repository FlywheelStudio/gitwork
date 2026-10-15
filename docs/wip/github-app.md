# WIP — Phase 2: GitHub App

Branch: `feature/github-app`

## Goal
An instance admin creates the GitHub App in a few clicks, orgs install it, webhooks keep a local
cache of issues and Projects v2 items current, and a reconcile repairs anything webhooks missed.
Exit checks (spec): a replayed webhook changes nothing; reconcile repairs a dropped event. Also
from Phase 1: the GitHub OAuth link callback gets an end-to-end test.

## Approach

**Instance admins.** `INSTANCE_ADMIN_EMAILS` (env, comma-separated). A user signed in with one of
those emails is an instance admin. No setup token, no "first visitor wins": proving the email
proves the admin. Admins create the GitHub App and set the sign-up policy.

**Setup wizard (`/setup`).** Admin only. Steps: (1) email works (they signed in), (2) create the
GitHub App, (3) sign-up policy (defaults to `invite-only` once setup runs).

**GitHub App via manifest flow.** The wizard POSTs a manifest to
`github.com/settings/apps/new` (personal) or `github.com/organizations/<org>/settings/apps/new`,
with a random `state` stored server-side. GitHub redirects to `/setup/github/callback?code&state`;
the server exchanges the code (`POST /app-manifests/{code}/conversions`) for id, slug, client
id/secret, webhook secret, and private key, and stores them.
- Manifest: permissions contents rw, issues rw, pull_requests rw, metadata r, organization
  projects rw, members r; events issues, issue_comment, sub_issues, issue_dependencies, label,
  push, pull_request, repository, projects_v2, projects_v2_item; webhook
  `/api/github/webhook`; callback `/api/auth/callback/github`; setup URL `/github/installed`.
- **Config resolution:** env (`GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`,
  `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`) wins; otherwise the `github_app` row. The hosted
  version uses env.
- Secrets in the database are encrypted with AES-GCM, key derived (HKDF) from
  `BETTER_AUTH_SECRET`.

**GitHub client (`packages/server/src/github/`).** fetch-based, Web Crypto only (Node + Workers):
- App JWT (RS256). The manifest returns a PKCS#1 key; Web Crypto needs PKCS#8, so wrap it.
- Installation tokens cached in `github_installation_tokens` (encrypted, until 5 minutes before
  expiry) so isolates share them.
- REST + GraphQL helpers with backoff on secondary rate limits (403/429 + `retry-after`).
- Tests stub `fetch`; no real GitHub in CI.

**Installations.** `github_installations` from `installation` webhooks and from the setup URL
callback. Owners/Admins with a linked GitHub account get an "Install on GitHub" link
(`github.install_app` capability).

**Webhooks (`POST /api/github/webhook`).**
1. Verify `X-Hub-Signature-256` (HMAC-SHA256, constant-time compare). Bad → 401.
2. Record `X-GitHub-Delivery` in `github_webhook_deliveries` (`ON CONFLICT DO NOTHING`). Seen →
   200, no work.
3. Apply to the cache. Every cache write is guarded by GitHub's `updated_at`
   (`WHERE github_updated_at <= incoming`), so an old event never overwrites a newer row, even
   with a new delivery ID.
4. Inline processing for now (cache upserts are fast; GitHub waits 10 s).

**Cache tables.** `gh_repos`, `gh_issues` (title, body, state, state_reason, labels, assignees,
issue type, parent, timestamps), `gh_projects`, `gh_project_fields`, `gh_project_items`
(content type, content node id, field values JSON, archived). Sync is scoped to **sync targets**
(`gh_sync_repos`, `gh_sync_projects`): Phase 3 creates them when a workspace links a board and
repos; Phase 2 tests create them directly.

**Reconcile.** Every 15 minutes per installation:
- Repos: `GET /repos/{o}/{r}/issues?state=all&since=<last_synced_at>` (incremental, REST).
- Projects: page all items via GraphQL (no `since` on Projects v2), 100 per page.
- Budget per installation; skip targets synced recently; record `last_synced_at`.
- Node: in-process timer from `instrumentation.ts`. Workers: a Cron Trigger through a custom
  OpenNext worker entry with a `scheduled` handler.

**OAuth link callback test.** Stub GitHub's token and user endpoints; drive
`/link-social` → `/callback/github`; assert an `auth_identities` row with encrypted tokens and a
refresh token.

## Build order
1. Crypto: AES-GCM secret box, HMAC verify, RS256 JWT with PKCS#1 → PKCS#8 (both runtimes).
2. Schema + migration.
3. GitHub client + installation tokens (stubbed fetch).
4. Webhook endpoint + cache writers + idempotency/ordering tests.
5. Reconcile + scheduler (Node timer, Workers cron) + "dropped event" test.
6. Manifest flow + setup wizard + install link + OAuth callback test.
7. Smoke: signed webhook and cron trigger on the Worker.

## Open questions
- Does a GitHub redelivery reuse the original `X-GitHub-Delivery` ID? (Guarded by `updated_at`
  either way.)

## Build log
- 2026-10-15: Branch created. Decision 018 (member list visible to all members) recorded.
- Spikes passed: custom Worker entry (`apps/web/worker.ts`) runs a `scheduled` handler on the
  local preview; the crypto module passes the same tests on Node and inside workerd
  (`unstable_startWorker`; `@cloudflare/vitest-pool-workers` needs Vitest 4).
- GitHub facts (research 2026-10-15): redelivery reuses `X-GitHub-Delivery`; GitHub never retries
  failed deliveries on its own (reconcile is the only safety net); 10 s timeout. `projects_v2_item`
  payloads carry `updated_at` and field `changes`, but the App availability of Projects webhooks is
  unverified — items are treated as "refetch" signals. Projects v2 GraphQL lists only
  `NOT_ARCHIVED` items by default: the query asks for both, or the sweep would tombstone archived
  items. Manifest permission for emails is `email_addresses`.
- Webhooks: delivery row + guarded writes in one batch. Ties on `updated_at` refetch from GitHub.
  Deletes are permanent tombstones. Replacing the timestamp guard with `1 = 1` fails the ordering
  and tombstone tests on both drivers.
- Reconcile: lease row, bounded targets/pages, `since` with 2-minute overlap, daily full sweep
  that tombstones unseen issues; projects list every item each run. Lists go to SQL as one
  `json_each(?)` parameter (D1's 100-parameter cap).
- Installation tokens shared via `github_installation_tokens` (sealed), renewed 5 minutes early.
