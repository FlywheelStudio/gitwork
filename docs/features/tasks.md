# Tasks on web — link, list, kanban, timeline, edit

Shipped 2026-10-15 (Phase 3). Branch `feature/tasks`. Decisions 006, 008, 009, 012, 020, 021.

## What it does
- An Owner or Admin with linked GitHub links the workspace to **one board and its repos** in
  Workspace → Settings. The choices come from what their own GitHub account can see.
- Everyone in the workspace sees the board's tasks as a **list** (sub-issues nested), a **kanban**
  (group by Status or any single-select field, drag to move), and a **timeline** (start and target
  dates, or the iteration; "blocked by" arrows).
- Owners, Admins, and Members create tasks (always a real issue in a linked repo, then added to the
  board) and edit title, description, open/closed, and board fields.
- Admins map fields (kanban column field, timeline start/end, iteration) and set the hide label and
  "Show draft items to Read Only".
- Read Only users never receive an issue with the hide label, a draft (unless the setting is on),
  or anything from a repo the workspace did not link.

## How it works

**Code.**
| File | Role |
|---|---|
| `packages/core/src/visibility.ts` | `isTaskVisible()`: the fail-closed filter. `visibilityContext()` from role + settings. |
| `packages/core/src/brand.ts` | `withBotAttribution()`: one trailing attribution line, replaced on re-edit. |
| `packages/server/src/services/link.ts` | `listLinkCandidates()`, `linkWorkspace()`, `unlinkWorkspace()`, `getWorkspaceLink()`. |
| `packages/server/src/services/tasks.ts` | `listTasks()`, `getTask()`, `createTask()`, `updateTask()`, `setFieldMapping()`, `resolveMapping()`. |
| `packages/server/src/services/audit.ts` | `auditInsert()`: one statement for a write batch. |
| `packages/server/src/services/workspace-settings.ts` | Hide label, Read Only drafts/comments switches. |
| `packages/server/src/github/user-token.ts` | `userGitHubToken()`: the user's App user token, refreshed under a per-user lease. |
| `packages/server/src/leases.ts` | `acquireLease()` / `releaseLease()` in `sync_leases` (reconcile and user tokens). |
| `apps/web/src/app/w/[workspaceId]/` | `page.tsx` (views), `tasks/` (views, new-task dialog, detail + editor), `settings/`. |

**API (`/api/v1/workspaces/:id/…`).** `GET tasks`, `GET tasks/:itemId`, `POST tasks`,
`PATCH tasks/:itemId`, `GET github`, `GET github/candidates`, `PUT github`, `DELETE github`,
`PATCH github/fields`, `PATCH settings`. Write routes check the role before anything else, so a
Read Only user learns nothing about the instance's GitHub setup.

**Link (decision 020).** The picker and the save both use the user's own token:
`GET /user/installations` → `GET /user/installations/{id}/repositories` → `node(id)` on the board,
whose owner must be the installation's org. Save is one batch: `workspace_github`,
`workspace_repos`, repo and board rows, `gh_sync_targets` (insert-or-ignore), pruning of unused
targets, an audit row. Then a bounded first sync (`reconcile({ onlyNodeIds, maxPages: 3 })`).

**Reads.** One query: board items left-joined to cached issues, then `isTaskVisible()` per item.
The issues webhook caches every installed repo, so issues from unlinked repos **are** in the cache;
the filter is what keeps them out. Links (`gh_issue_links`) resolve to item ids only when the other
end is visible to the viewer; otherwise the edge is dropped (a hidden parent → the child shows at
top level).

**Writes (decision 021).** `asActor()` runs each GitHub call with the user's token, and again as
the App on "access denied". Field changes are checked against the board's fields and options before
any GitHub call. GitHub's response goes straight into the cache (`"fresh"`), and the audit row goes
in the same batch.

**User tokens.** Fresh tokens (more than 60 s left) are read without a lock. A token near expiry
takes the `user-token:<userId>` lease (30 s); others wait up to 10 s, re-reading the identity, and
use the new token. A failed refresh means "re-link GitHub" (linking) or "write as the App" (tasks).

**Issue links.** `ITEM_FIELDS` now asks for `parent { id }` and `blockedBy(first: 25)` on issue
content, so board syncs and `projects_v2_item` refetches keep `gh_issue_links` current.
`sub_issues` and `issue_dependencies` webhooks refetch the links of every issue named in the
payload (`IssueLinks` query) instead of trusting it.

**Field mapping.** Stored ids win when they still fit the field type. A stored null means
**auto-detect** (the settings form labels it so); there is no "none" (decision 009). Auto-detect: kanban = a
single-select named "Status", else the first one; start = "Start date"/"Start"; end = "Target
date"/"End date"/"Due date"/"Due"; iteration = the first iteration field.

## Data model (migration 0004)
- `workspace_github` — one row per linked workspace: installation, board, field mapping, who linked.
- `workspace_repos` — the workspace's repos.
- `gh_issue_links` — parent and blocked-by per issue.
- `audit_log` — every write (`via` user / app / local). References set null on delete.
- `workspaces.hide_label`.

## UI
shadcn/ui (Radix, Nova preset) is adopted. `src/components/ui/` holds the CLI's files unchanged;
`src/components/kit.tsx` wraps them for the app (Button variants, a native Select, Card, ErrorText).
Add components with `pnpm exec shadcn add <name>` from `apps/web`.

## Testing
- `packages/core`: visibility per role, hide label case, drafts setting, fail-closed types;
  attribution replace/no-stack.
- `link.test.ts` (both drivers): candidates limited to the user; success writes targets and syncs;
  refused: a repo the App reaches but the user cannot, an installation the user cannot see, a board
  from another org, repos from another installation; GitHub gate and role; re-link on a dead token;
  target pruning; mapping reset only on a new board.
- `tasks.test.ts` (both drivers): Member vs Read Only views; unlinked repo, PR, archived never
  shown; links never point at hidden tasks; 404 for hidden single tasks; user write, App write with
  attribution, fallback when the user's GitHub cannot write; validation before any GitHub call;
  edits and field clears; draft moves; partial-failure audit.
- `user-token.test.ts`: no lease for fresh tokens; one refresh for two concurrent requests; 503 when
  the lease stays held; a failed refresh releases the lease.
- `api-tasks.test.ts`: 401, 403, 400, 409 (no App), 503 + Retry-After.
- `webhooks.test.ts`: `sub_issues` / `issue_dependencies` refetch links.
- E2E `tasks.spec.ts` (exit check): a Read Only user gets exactly the visible tasks from the API,
  404 for hidden ones, and no hidden title or id in any view or task page.
- **Proven red:** disabling each link check (repo, installation, board owner) fails its test;
  disabling the repo filter or the hide-label check fails both the unit tests and the E2E test;
  resolving links against all rows fails the link tests.

## Gotchas
- **Issues from unlinked repos are in the cache.** Tests must seed them (link two repos, then
  re-link one), or a broken repo filter still passes. This happened once while writing the tests.
- **Better Auth deletes linked identities of an unverified user on code sign-in**
  (`revokeUnprovenAccountAccess`). Real users verify on first sign-in; test fixtures must set
  `emailVerified: true`.
- **D1 test reset** drops tables in foreign-key order, read from the `CREATE` statements (D1 refuses
  `pragma_foreign_key_list`). drizzle-kit creates tables alphabetically, so neither name nor
  creation order is a dependency order.
- **Worker bundle:** 3.40 MiB gzipped (3.23 MiB before this phase), over the Workers Free plan's
  3 MiB. Cloudflare hosting requires the Paid plan (decision 022).
- **Not tested against real GitHub.** `/user/installations/{id}/repositories`, the Projects v2
  mutations, and the `sub_issues` / `issue_dependencies` payload keys follow GitHub's docs and the
  live GraphQL schema (introspected 2026-10-15), not real calls. See STATE → live check.
- Issue bodies render as plain text until the Phase 4 markdown renderer exists.
