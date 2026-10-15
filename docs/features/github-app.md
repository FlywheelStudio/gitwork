# GitHub App — setup, installations, webhooks, cache, reconcile

Shipped 2026-10-15 (Phase 2). Branch `feature/github-app`. Decisions 004, 009, 010, 016, 019.

## What it does
- An **instance admin** (`INSTANCE_ADMIN_EMAILS`) opens `/setup` and creates the instance's GitHub
  App in a few clicks (GitHub's manifest flow), and sets the sign-up policy.
- Owners and Admins with a linked GitHub account get an **"Install the GitHub App"** link on the
  workspace page.
- **Webhooks** keep a local cache of repos, issues, and Projects v2 boards/fields/items current.
- **Reconcile** runs every 15 minutes and repairs anything webhooks missed.
- **Linking GitHub** (Settings) stores the user's App user token encrypted, and refreshes it when
  it expires (8 hours).

## How it works

**Code.** `packages/server/src/github/`:
| File | Role |
|---|---|
| `crypto.ts` | Web Crypto only: secret box (AES-GCM, HKDF from `BETTER_AUTH_SECRET`, purpose-bound, `v1.` prefix), webhook HMAC verify, RS256 App JWT (wraps the manifest's PKCS#1 key as PKCS#8). |
| `config.ts` | `loadGitHubAppConfig()`: all five env vars win; else the sealed `github_app` row. |
| `client.ts` | fetch-based client: App JWT (iat −60 s, 9 min), installation tokens shared via `github_installation_tokens` (sealed, renewed 5 min early), REST + pagination, GraphQL, `GitHubRateLimitError`. |
| `cache.ts` | One-statement cache writers with guards; `inJsonList()` for lists. |
| `webhooks.ts` | `handleGitHubWebhook()`. |
| `reconcile.ts` | `reconcile()`. |
| `setup.ts` | Manifest flow, install URL, `confirmInstallation()`, instance admins. |
| `../sync.ts` | `runScheduledReconcile()`: light entry for the cron/timer; records `reconcile_last_run`. |

**Web.** `/setup`, `/setup/github/callback`, `/github/installed`, `POST /api/github/webhook`,
`/api/v1/setup*`. `apps/web/worker.ts` wraps OpenNext's fetch handler and adds the `scheduled`
handler (Cron Trigger `*/15 * * * *`). On Node, `src/instrumentation.ts` starts a 15-minute timer
through the build-time runtime alias (a no-op in the Worker build).

**Webhook flow.** Verify `X-Hub-Signature-256` on the raw body → skip a known delivery ID →
fetch anything needed from GitHub → **one batch**: the delivery row, then guarded cache writes.
A duplicate fails on the delivery key and rolls the batch back; a real failure leaves no trace, so
a redelivery (same delivery ID) or reconcile still applies it. GitHub never retries failed
deliveries on its own.

**Cache guards (in each statement).**
- Webhook payloads apply only when GitHub's `updated_at` is strictly newer.
- Timestamps have one-second resolution: on a tie the issue is refetched from GitHub.
- Deletes and transfers are permanent tombstones (`deleted = 1`); nothing revives them.
- `projects_v2_item` events are treated as "refetch this item" signals (the App availability of
  Projects webhooks is not documented clearly; reconcile covers them either way).
- Removed repos, deleted or suspended installations set `available = 0`. Unsuspend does **not**
  restore them all (that would undo earlier removals); reconcile re-checks each target.

**Reconcile.** A lease row (`sync_leases`, 10 min) keeps runs single. Each run takes up to
`RECONCILE_MAX_TARGETS` (default 3) targets, oldest first, with up to `RECONCILE_MAX_PAGES`
(default 10) GitHub pages each. **Every page saves its progress**, so a run cut short by a Workers
limit still moves forward.
- Repo, incremental: `GET …/issues?state=all&sort=updated&direction=asc&since=<cursor − 1 s>`,
  pull requests dropped. The cursor is the last issue's `updated_at` mid-pass, or our start time
  minus 2 minutes (clock skew) after a complete pass. A page that makes no progress (a full page
  in one second) steps the cursor forward; the daily sweep catches anything skipped.
- Repo, daily deletion sweep (resumable): list by creation order with a saved page cursor, mark
  each issue seen (`synced_at`), then **verify the unseen ones with GitHub** (`nodes(ids:)`) and
  tombstone only those that are gone or moved. A page shift during the sweep can make it miss a
  live issue; verification keeps it. The sweep always gets at least one page per run.
- A repo marked unavailable is re-checked (`GET /repos`) every run.
- Board: every item (Projects v2 has no `since`), cursor saved per page, **archived included**
  (`archivedStates: [ARCHIVED, NOT_ARCHIVED]`), then the same verify-then-tombstone step.
- Rate limit → stop the run, report `rateLimited`.
- Each scheduled run also prunes deliveries older than 14 days, expired setup states, and
  rate-limit rows older than a day, and records `reconcile_last_run`.

**Sync targets** (`gh_sync_targets`) decide what reconcile covers. Phase 3 creates them when a
workspace links a board and repos.

**Setup security.**
- `/setup` and its API are instance-admin only (404 / 403 otherwise).
- Manifest `state`: random, stored hashed, bound to the admin's user id, single-use, 10 minutes.
- The callback never overwrites an existing App (plain INSERT on a singleton key).
- `/github/installed?installation_id=…` is not trusted: the server asks GitHub
  (`GET /app/installations/{id}` with the App JWT) before recording it.

## Data model (migration 0002)
`github_app` (singleton), `github_manifest_states`, `github_installations`,
`github_installation_tokens`, `github_webhook_deliveries`, `gh_repos`, `gh_issues`, `gh_projects`,
`gh_project_fields`, `gh_project_items`, `gh_sync_targets`, `sync_leases`.

## Testing
- Crypto: same suite on Node and **inside workerd** (`unstable_startWorker`, asserts
  `navigator.userAgent === "Cloudflare-Workers"`), PKCS#1 and PKCS#8 keys.
- Webhooks, reconcile, setup on **libsql and D1** against an in-memory fake GitHub
  (`test/fake-github.ts`): bad signature, replay changes nothing, older event never wins, tie
  refetches, tombstones stick, failure leaves no delivery row, installation add/remove/delete,
  project items; dropped event repaired, `since` overlap, full-sweep tombstones, page budget
  resume, 404 → unavailable, rate limit stop, lease, webhook newer than reconcile data, archived
  items kept, removed items tombstoned; manifest state rules, no overwrite, env precedence,
  confirmed installations only, admin sign-up.
- OAuth link callback with GitHub stubbed at `fetch`: link with a different/private email, tokens
  encrypted, 8-hour expiry, one refresh with the refresh token; GitHub sign-in never creates a user.
- E2E: admin finishes setup (policy switch), a stranger is refused under invite-only, non-admin
  `/setup` is 404.
- `pnpm smoke` (Worker): bundle scans of `.open-next` **and** the final `wrangler deploy --dry-run`
  output; signed `ping` 200 / bad signature 401; the Cron Trigger completes a reconcile.
- Proven red: replacing the timestamp guard with `1 = 1`. Multi-run tests: a repo larger than one
  run's budget completes over several runs (sweep included); a page of same-second issues still
  progresses; a live issue the sweep missed is kept after verification. Secret rotation keeps
  sign-in working and allows an admin replace. Unsuspend keeps removed repos hidden.

## Gotchas
- **GitHub must reach the webhook URL.** For local development use a tunnel (e.g.
  `cloudflared tunnel --url http://localhost:3000`) and set `BETTER_AUTH_URL` to it *before*
  creating the App: the manifest bakes in the URLs.
- **Rotating `BETTER_AUTH_SECRET`** makes the stored App credentials and linked GitHub tokens
  unreadable. Sign-in keeps working (`createRequestDeps()` treats GitHub as not set up and sets
  `githubError`); `/setup` shows the error and offers "Forget the stored App and start over".
  Users re-link GitHub.
- **Workers query limits are unverified.** Cloudflare's docs do not say whether a D1 `batch()`
  counts as one query or one per statement toward the per-invocation limit (50 Free / 1000 Paid).
  The defaults assume the Paid plan; on Free, lower `RECONCILE_MAX_PAGES`. Measure on a real deploy.
- **Never tested against real GitHub.** The manifest flow, App availability of `projects_v2*`
  webhooks, and real payload shapes are covered only by docs and the fake. See STATE.
- **Two concurrent refreshes of one user token can lock the user out** (GitHub invalidates the old
  refresh token). Phase 3 must serialize user-token use per user.
- **Projects v2 lists only non-archived items by default.** The sweep would tombstone archived
  items without `archivedStates`.
- **`@ts-ignore` in `worker.ts`** is deliberate: `.open-next/worker.js` exists only after a build,
  so `@ts-expect-error` fails in one of the two states.
- **The Next route file must export every method the router uses** (`PUT` was missing; Next
  returned 405 before the router ran). Covered by the setup E2E.
- `sub_issues`, `issue_dependencies`, and `label` events are recorded but not yet applied;
  reconcile refreshes labels on the next pass. Phase 3 adds parent/dependency fields.
