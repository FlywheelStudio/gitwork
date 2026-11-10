# Roadmap — self-host release and Linear-class speed

Date: 2026-11-10 · Status: **Accepted** by the owner, 2026-11-10. Answers Q0–Q10 are all "yes"; records 023–032.

Two goals from the owner:

1. Make Gitwork ready for anyone to self-host as an open-source product.
2. Match Linear's features, with the most weight on speed, keyboard shortcuts, and a clear UI.

GitHub stays the source of truth (spec, decision 009). A Linear feature that needs data GitHub
cannot hold gets a question for the owner, not a quiet local table.

"Decision NNN" means a record in `decisions/`. "Q*n*" means a question in the last section.

## Order of work

| Step | Work | Why this order |
|---|---|---|
| 0 | Remove the iCloud copies from PR #5 | Blocks every deploy (below). |
| 1 | Live GitHub check | No code has touched real GitHub. Every later step builds on these payloads. |
| 2 | Track A — self-host release v0.1 (tasks only) | Phase 7, pulled forward. |
| 3 | Track B + C + D — speed, keyboard, layout | The foundation every parity feature uses. |
| 4 | Track E, tier 1 — core Linear parity | Triage, My tasks, properties, comments, saved views, bulk edit. |
| 5 | Phase 4 — Docs on web | Projects-as-docs (E, tier 2) needs the docs editor. |
| 6 | Track E, tier 2 | Cycles, projects, PR links, templates. |
| 7 | Phase 6 — Mac app | Reuses the sync endpoint and the keymap from Tracks B and C. |

Phase 5 (Activity, inbox) merges into Track E, tier 1.

## Step 0 — iCloud copies in PR #5 (blocker)

Commit `0943411` on `feature/live-check` (PR #5) adds 24 files named `<name> 2.<ext>`:
`package 2.json`, `pnpm-lock 2.yaml`, `apps/web/worker 2.ts`, and others. They are older copies, with
no content that the real files lack.

- **One of them breaks Cloudflare deploys.** `packages/db/migrations/0003_resumable_sweep 2.sql`
  sits in wrangler's `migrations_dir`. `wrangler d1 migrations list DB --local` lists it as pending.
  On any D1 database, wrangler would run that migration a second time.
- **Cause:** the repo is under `~/Documents`, and iCloud Desktop & Documents sync is on
  (`~/Library/Mobile Documents/com~apple~CloudDocs/Documents` links to `~/Documents`). iCloud
  writes `<name> 2` copies when it sees a conflict. `git rm` alone will not hold while sync is on.

Fix:
1. `git rm` the 22 files on `feature/live-check`.
2. Turn off iCloud Desktop & Documents sync, or move the whole `~/Documents/Flywheel` tree (for
   example to `~/Flywheel`). Moving only `gitwork` breaks CLAUDE.md discovery (the workspace file
   sits in `Flywheel/`), the `../../conventions` import, and the Claude memory folder's path key.
3. Add a CI step that fails on any tracked file matching `* [0-9].*`.
4. Add a `pnpm smoke` step that compares `wrangler d1 migrations list` with drizzle's
   `_journal.json`.

## Track A — self-host release

**Gate:** the live GitHub check (step 1). The Phase 7 exit check ("a fresh self-host from the README
reaches a working workspace") cannot pass without it.

| # | Item | Detail |
|---|---|---|
| A1 | Docker image | Next `output: "standalone"`, `node:22-slim`, non-root user. SQLite file on a `/data` volume. Migrations run on boot. `HEALTHCHECK` on `/api/v1/health`. |
| A2 | `docker-compose.yml` | Gitwork plus an optional Caddy service for TLS. One `.env` file. |
| A3 | Release pipeline | On a `v*` tag: build a multi-arch image to GHCR, write a GitHub Release with notes. Semver. `CHANGELOG.md`. |
| A4 | Deploy to Cloudflare | Button in the README. Verify that it provisions D1 from `wrangler.jsonc` (the placeholder `database_id` must go), and that `WORKER_SELF_REFERENCE` still works when the user renames the Worker. State the Workers Paid plan (decision 022). Explain the Email Service domain step. |
| A5 | Boot-time config check | Validate the environment with zod at boot. A missing secret shows one clear error page, not a stack trace. |
| A6 | Admin health page | `/setup/health`: email transport, GitHub App, last webhook, last reconcile, database driver, version. One line per check, green or red. |
| A7 | Operations | Backups: a documented `sqlite3 .backup` cron for Node; D1 Time Travel for Cloudflare. Upgrades: pull the new image, migrations run on boot. Secret rotation: repeat the decision 019 warning. |
| A8 | Self-host guide | `docs/self-host/`: Docker, Cloudflare, any Node host, reverse proxy, the public webhook URL, email, creating the GitHub App. |
| A9 | Repo hygiene | Rewrite the README (it still says "Phase 0 of 7"). Add `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, and issue and PR templates. Remove the Next starter files in `apps/web/public/`. No telemetry. |
| A10 | Exit check in CI | A job runs `docker compose up`, waits for health, and signs in with an email code. |

**Owner decisions in this track:** confirm `AGPL-3.0-only` (decision 001 still says "pending owner
confirmation"), and choose DCO or CLA for contributions (Q2).

## Track B — speed

Linear feels fast because the client holds the data and every action changes the screen before the
server answers. Gitwork today does the opposite. Each view switch is a `Link` to `?view=`, so the
server renders the page again and runs `listTasks()` again. Each edit waits for GitHub, which takes
300 ms to over 1 s.

### Budgets

Each budget gets a Playwright test against a fixture board with 2,000 tasks.

| Action | Budget |
|---|---|
| Switch list / board / timeline, change a filter, sort, or group | No network request. Next frame (< 16 ms of script). |
| Open a task from a list | < 100 ms, from the client store. |
| Edit a property (status, priority, assignee) | The screen changes in < 50 ms. The GitHub write runs after. |
| Open the command menu | < 50 ms. Results for 2,000 tasks in < 50 ms. |
| Cold load of a workspace | First tasks on screen < 1.5 s on a fast connection. |
| Worker bundle | ≤ 10 MiB gzipped; `pnpm smoke` fails above it (decision 022 follow-up). |

### Work

| # | Item | Detail |
|---|---|---|
| B1 | Client store | `GET /api/v1/workspaces/:id/sync` returns every task the viewer may see, plus fields, members, and a cursor. The server filters with `isTaskVisible()` as now. The browser keeps it in memory and in IndexedDB, keyed by user and workspace, cleared on sign-out. Views read the store. View, filter, and sort state lives in the URL through `history.replaceState`, with no server render. |
| B2 | Deltas | A `workspace_changes` table (sequence, entity, id), written by `github/cache.ts` in the same batch as the cache row. `GET …/sync?since=<cursor>` returns changed rows, filtered per viewer. A task that becomes hidden returns as a tombstone. |
| B3 | Live updates | First: poll the delta endpoint every 5 s while the tab is visible, and on focus. Works on both runtimes. Later: server push through a new decision 004 adapter (SSE on Node, a Durable Object per workspace on Cloudflare). |
| B4 | Optimistic writes | The client applies a change at once, sends it, and rolls it back with a toast if the server refuses. Single edits stay synchronous with GitHub on the server (decision 021). `Cmd+Z` undoes the last change. |
| B5 | Bulk writes | Multi-select edits go through the job queue (decision 004), paced under GitHub's ~80 writes per minute. A progress bar shows the count. This is asynchronous, so it amends decision 021 (Q5). |
| B6 | Rendering | Virtualized list rows. Task detail opens in a side panel ("peek"), not a new page. Prefetch task bodies on hover. |

**Visibility rule for every new read path:** the sync endpoint, deltas, search, the command menu, and
the IndexedDB cache only ever hold what the server sent for that viewer. The Read Only E2E exit check
(Phase 3) extends to each of these paths. Three rules keep deltas from leaking hidden items:

- Send a tombstone only for an ID the client already holds. A Read Only client must never receive
  the ID of a hidden task.
- Make the cursor opaque (signed, not a plain sequence number). Gaps in a readable sequence would
  let a Read Only user count hidden changes.
- Each sync response carries a visibility key (role plus hide settings). When it changes, the client
  drops its IndexedDB cache and loads a fresh snapshot. A Member demoted to Read Only keeps nothing.

## Track C — keyboard

| # | Item | Detail |
|---|---|---|
| C1 | One keymap | `packages/core/src/keymap.ts` holds every shortcut as data: keys, scope (global, list, task, editor), command id. The web app and the Mac app both read it. A unit test fails on two commands with the same keys in one scope. |
| C2 | Command menu | `Cmd+K` (shadcn `Command`, built on cmdk). Every action in the app is a command. Commands know the selection, so "Set status" applies to the selected tasks. |
| C3 | Help | `?` opens a shortcut sheet generated from the keymap. Menus and tooltips show each command's keys from the same source. |
| C4 | Guard | Single-key shortcuts never fire inside an input, a textarea, or the CodeMirror editor (Phase 4). |
| C5 | Tests | An E2E test for each shortcut in the tables below. |

Default keys follow Linear, so Linear users need no new habits. Before we freeze the keymap, check
each key against Linear's in-app list (`?`).

**Global**

| Keys | Command |
|---|---|
| `Cmd+K` | Command menu |
| `/` | Search |
| `?` | Shortcut sheet |
| `C` | New task |
| `G` then `I` / `M` / `T` / `V` / `S` | Go to Inbox / My tasks / Triage / Views / Settings |
| `Cmd+B` | Switch list ↔ board |
| `F` | Filter |
| `Cmd+Z` | Undo |
| `Esc` | Close the panel, then clear the selection |

**List and board**

| Keys | Command |
|---|---|
| `J` / `K` or `↓` / `↑` | Move focus |
| `X` | Select the focused task |
| `Shift+↓` / `Shift+↑` | Extend the selection |
| `Cmd+A` | Select all in view |
| `Space` | Peek (side panel) |
| `Enter` | Open the task |

**Focused or selected tasks**

| Keys | Command |
|---|---|
| `S` | Status |
| `P` | Priority |
| `A` | Assignees |
| `I` | Assign to me |
| `L` | Labels |
| `E` | Estimate |
| `Shift+D` | Due date |
| `Shift+C` | Cycle (iteration) |
| `Shift+P` | Project |
| `Cmd+.` | Copy the ID (`repo#123`) |
| `Cmd+Shift+,` | Copy the URL |
| `Cmd+Shift+.` | Copy a branch name |
| `Cmd+Enter` | Save a comment or a form |

## Track D — a clear UI

| # | Item | Detail |
|---|---|---|
| D1 | App shell | Left sidebar: workspace switcher, Inbox, My tasks, Triage, Views, Favorites. The top bar of each view holds the view switch, filter chips, and "Display" (group, sort, properties, density). |
| D2 | Task row | One dense line: status icon, priority icon, ID, title, labels, assignee avatar, due date. One icon and color per status everywhere. |
| D3 | Task panel | Title and body on the left, properties on the right, activity below. Every property edits in place. |
| D4 | Write path made visible | Next to Save: "Saves to GitHub as you" or "Saves as Gitwork, signed with your name" (decision 008). |
| D5 | Sync state | A quiet "Synced 10 s ago" in the sidebar. It turns amber when the last delta failed. |
| D6 | Empty states | Each one names the next action and its shortcut ("Press C to create a task"). |
| D7 | Role clarity | Show the viewer's role in the sidebar. Never show counts or hints of hidden items to Read Only (decision 012). |
| D8 | Basics | Dark mode, visible focus rings, ARIA roles on lists and menus, reduced motion. |

## Track E — Linear parity

Tier 1 ships first. "Local" means stored in the Gitwork database, not GitHub.

### Issues

| Linear feature | GitHub home | Stored | Tier |
|---|---|---|---|
| Status | Board single-select "Status" (exists) | GitHub | Done |
| Priority | Board single-select "Priority", auto-detected like Status | GitHub | 1 |
| Estimate | Board number field "Estimate" | GitHub | 1 |
| Assignees | Issue assignees (GitHub users only, Q8) | GitHub | 1 |
| Labels | Repo labels, merged by name across the workspace's repos | GitHub | 1 |
| Due date | Board date field (end mapping exists) | GitHub | Done |
| Sub-issues | Native sub-issues (read exists); add create and re-parent | GitHub | 1 |
| Blocked by | Native dependencies (read exists); add edit | GitHub | 1 |
| Duplicate | Close as duplicate (`state_reason`) | GitHub | 2 |
| Related | No GitHub field | — | Skip |
| Issue types | Org issue types | GitHub | 2 |
| Comments, reactions, mentions | Issue comments and reactions; @mention for linked users, in-app mention for others | GitHub | 1 |
| Templates | `.github/ISSUE_TEMPLATE/` in the repo | GitHub | 2 |
| Archive, delete | Close as not planned; archive the board item | GitHub | 1 |
| Copy ID, URL, branch name | — | — | 1 |
| Select and bulk edit | Track B5 | GitHub | 1 |

### Planning

| Linear feature | GitHub home | Stored | Tier |
|---|---|---|---|
| Cycles | Board iteration field: current, next, previous; "move unfinished to next" | GitHub | 2 |
| Cycle and project graphs | Needs history: an event table fed by webhooks | Local | 3 |
| Projects | Board single-select "Project", plus `docs/projects/<slug>.md` for description, lead, status, target date (Q7) | GitHub | 2 |
| Project timeline | Timeline grouped by Project | — | 2 |
| Milestones | Repo milestones (one repo only) | GitHub | 3 |
| Project updates | `docs/updates/` markdown | GitHub | 3 |
| Initiatives | Across workspaces | — | Skip (Q9) |
| Releases | GitHub Releases, read only | GitHub | 3 |

### Intake

| Linear feature | GitHub home | Stored | Tier |
|---|---|---|---|
| Triage | Open issues in linked repos that are not on the board. Accept = add to board with a status (Q10) | GitHub | 1 |
| Asks / requests | Read Only "file a request" (role setting exists) creates an issue in Triage | GitHub | 2 |
| Triage rules, SLAs | — | — | Skip |

### Views and navigation

| Linear feature | Home | Stored | Tier |
|---|---|---|---|
| My tasks | Assigned to my linked GitHub login, plus tasks I created or follow | — | 1 |
| Custom views | Saved filter, group, sort; personal or shared | Local | 1 |
| Filters, display options | Client store (B1) | — | 1 |
| Favorites | — | Local | 1 |
| Search | Client store first; SQLite FTS5 for bodies and docs later | — | 1 / 2 |
| GitHub's own board views | Import read only | GitHub | 3 |

### Collaboration

| Linear feature | Home | Stored | Tier |
|---|---|---|---|
| Inbox, notifications | Phase 5, with keyboard triage (mark read, snooze, unsubscribe) | Local | 1 |
| Pulse, activity | Phase 5 audit log | Local | 2 |
| Documents | Phase 4 | GitHub | Planned |
| Linked PRs and branches | Closing references; `createLinkedBranch` | GitHub | 2 |

### Out of scope (Q9)

SAML and SCIM, third-party integrations (Slack, Zendesk, Intercom, Sentry, Figma), importers (GitHub
already holds the data), Linear's AI agent and coding agent, an MCP server (needs personal API
tokens, already "Later"), recurring issues, insights dashboards, mobile apps.

## Questions for the owner (answered: all yes)

Q0 is done on PR #5. Q1–Q10 are decisions 023–032; Q5 amends 021.

The owner answers these by number. Each has a recommended answer; "yes" accepts it. Decision records
follow the answers.

Q0. Remove the 24 iCloud copies on `feature/live-check`, and stop iCloud from syncing the repo
   (see step 0 for how).
Q1. "Host open source" means a self-host release (Docker, Cloudflare button, guide). Public boards
   for open-source maintainers (no sign-in, personal-account repos) is a separate, later item.
Q2. License `AGPL-3.0-only`, with a DCO sign-off for contributions, not a CLA. Trade-off: without a
   CLA, Flywheel cannot later sell closed add-ons built on outside contributions.
Q3. Ship self-host v0.1 with tasks only, before Phase 4 (Docs).
Q4. Speed: client store, IndexedDB cache, and 5 s polling of deltas first. Server push later.
Q5. Optimistic edits on the client; single edits stay synchronous on the server (decision 021).
   Bulk edits (B5) are the one exception: they run through the job queue, which amends decision 021.
Q6. Linear's default keys, as in Track C.
Q7. A Linear "project" is a board single-select field plus a doc in `docs/projects/`. A workspace
   keeps one board (decision 006).
Q8. Assignees are GitHub users only. Members without GitHub follow tasks; they are not assignees.
Q9. The "Out of scope" list stays out of v1.
Q10. Triage is open issues in linked repos that are not on the board, for Members and up.
