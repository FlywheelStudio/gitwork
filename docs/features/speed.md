# Speed foundation — client store, polling sync, optimistic edits, side panel

Shipped 2026-11-10 (roadmap Track B). Branch `feature/speed`. Decisions 021, 026, 027, 033.

## What it does
- **View switches stay in the browser.** List, board, and timeline read one client store. The URL
  updates with `history.replaceState`; nothing goes to the server.
- **Live data without reloads.** The store polls `GET …/sync` every 5 s while the tab is visible
  and on focus. Unchanged data is a 304 with no body.
- **Optimistic edits.** A status change (side panel or kanban drag) shows at once. If the server
  refuses, the change rolls back and a notice says why. Each edit is undoable (`useTaskActions().undo`;
  the `Cmd+Z` key arrives with Track C).
- **Side panel ("peek").** A click on a task opens it beside the list from the store, with no page
  load. The description loads from the API; hovering a task prefetches it. A modified click (new
  tab) still opens the full task page.
- **New tasks** join the store and open in the panel, with no page load.

## How it works

| File | Role |
|---|---|
| `packages/server/src/services/board-sync.ts` | `boardSnapshot()`, `snapshotEtag()`, `serializedSnapshot()`. |
| `packages/server/src/api/routes.ts` | `GET /workspaces/:id/sync`: 200 + ETag, or 304. |
| `apps/web/src/lib/board-store.ts` | `BoardStore`: base snapshot, pending patches, polling, undo stack. Framework-free. |
| `apps/web/src/lib/field-values.ts` | Field input ↔ form string ↔ cached value; `withField()` patches. |
| `apps/web/src/app/w/[workspaceId]/board-context.tsx` | `BoardProvider`, `useBoard()`, `useTaskActions()`, detail cache, notices. |
| `apps/web/src/app/w/[workspaceId]/workspace-board.tsx` | View switch, sync status, notices, panel. |
| `apps/web/src/app/w/[workspaceId]/tasks/peek-panel.tsx` | The side panel; fields edit in place. |

**No flicker back.** Pending edits stay layered over every snapshot until the server answers. A
poll that started before an edit finished is discarded, and the next poll fetches without an ETag.

## Measured (2,000 tasks, local Chromium, `e2e/speed.spec.ts`)

| Action | Time | Requests |
|---|---|---|
| Switch to list | 23 ms | none |
| Switch to board | 53 ms | none |
| Switch to timeline | 60 ms | none |
| Open a task in the panel | same frame; body after one API call | 1 (`GET tasks/:id`) |
| First poll after load | — | 1 (`/sync`, 304) |

The roadmap budget is under 16 ms. Virtualized rows (roadmap B6) are the follow-up to reach it;
the test budget is 400 ms (`SWITCH_BUDGET_MS`) so slower CI machines pass.

## Testing
- `api-tasks.test.ts` (both drivers): 401; 200 with private ETag headers; 304 on a match; a Member's
  ETag differs from Read Only's; **leak test** — edits to a hidden issue, an unlinked repo's issue,
  and a draft give Read Only a 304 while the Member gets 200; a visible edit gives 200; a role
  change changes the snapshot. **Proven red:** hashing all cached issues fails the leak test.
- `board-store.test.ts`: optimistic apply, rollback, pending edit over a new snapshot, stale poll
  discarded, ETag sent and 304 kept, tasks dropped when the snapshot drops them, one request for
  concurrent polls, stable snapshot identity, undo; polling only while visible.
- `field-values.test.ts`: every field type; option names and iteration dates as the server stores.
- E2E `tasks.spec.ts` (exit check): Read Only's `/sync` has exactly the visible tasks and no hidden
  title or id; the panel shows no edit controls and nothing hidden.
- E2E `speed.spec.ts`: first poll 304; view switches with no request (proven red before task-link
  prefetch was turned off); panel without a page load; optimistic edit visible before a stubbed
  502, then rolled back with a notice; a stubbed success keeps the server's answer.

## Gotchas
- **A server component cannot read plain data from a `"use client"` module**; it gets a client
  reference. `VIEWS` lives in `views.ts`.
- **Next.js re-prefetches nav links after `history.replaceState`.** The speed test ignores
  requests with `next-router-prefetch`; task links set `prefetch={false}`.
- **React commits after `click()` returns.** Time a view switch until the DOM has the rows (a
  MutationObserver), not around `click()`.
- **The React Compiler lint rejects self-referencing `useCallback`s.** Task actions are plain
  functions built once in `useMemo`.
