# App shell and clear UI

Shipped 2026-11-10 (roadmap Track D). Branch `feature/shell`, on top of Tracks B and C.

## What it does
- **One workspace layout.** A sidebar on every workspace page: workspace, role, a "Search or run
  a command ⌘K" button, Tasks / Members / Settings, the shortcut sheet, sync status, and the user.
  Shortcuts, the command menu, and the side panel work on every workspace page.
- **The store survives navigation.** Moving between Tasks, Members, and Settings keeps the
  client store, focus, and selection; nothing reloads.
- **Dense, grouped list.** One 40 px line per task: priority bars, ID, status ring (check when
  closed), title, labels, due date (red when overdue), assignee avatars. Grouped by status in the
  field's option order, with counts. Sub-issues nest inside their group.
- **Virtualized list and timeline.** Only rows near the viewport are in the DOM (37 and 40 of
  2,000). `J`/`K` scroll
  the focused row into view, however far.
- **Board cards** show priority, ID, assignees, title (two lines), labels, and due date. Long
  columns show 50 cards and a "Show 50 more" button.
- **Where an edit goes.** The panel and the new-task dialog say "Edits save to GitHub as you" or
  "… through the Gitwork app, signed with your name" (decisions 008, 021). Read Only sees neither.
- **Empty states** name the next step ("No tasks yet. Press C to create one.").
- **Dark mode** follows the system setting, set before first paint.

## How it works

| File | Role |
|---|---|
| `apps/web/src/app/w/[workspaceId]/layout.tsx` | Reads the session, builds the snapshot once, renders the shell. |
| `…/workspace-shell.tsx` | `BoardProvider`, sidebar, panel, command layer, notices. |
| `…/board-context.tsx` | Split context: `useBoardApi()` (stable functions, the stores) and state (panel, notice, view). Rows use only the stable part. |
| `apps/web/src/lib/focus-store.ts` | Focus and selection outside React state; each row subscribes to its own booleans (`useRowFocus`). |
| `…/tasks/task-list.tsx` | Grouping and virtualization of the list. |
| `apps/web/src/lib/viewport.ts` | `useViewport()`: window scroll in 100 px steps as an external store; used by the list and the timeline. |
| `…/tasks/task-bits.tsx` | `StatusIcon`, `PriorityIcon`, `Labels`, `Avatars`, `DueDate`. |
| `packages/server/src/services/board-sync.ts` | `viewer.githubLinked` in the snapshot (the viewer's own state; decision 033's ETag reasoning holds). |
| `apps/web/src/app/layout.tsx` | The dark-mode script. |

## Measured (2,000 tasks, local Chromium, `e2e/speed.spec.ts`)

| | Track B | Track C | Track D | + timeline virtualization |
|---|---|---|---|---|
| Switch to list | 23 ms | 45 ms | 14–18 ms | **6 ms** |
| Switch to board | 53 ms | 105 ms | 7 ms | **7 ms** |
| Switch to timeline | 60 ms | 58 ms | 27–32 ms | **10 ms** |
| `J` focus move | — | — | 0.3 ms median, 0.6 ms worst | 0.3 ms |
| Rows in the DOM (list / timeline) | 2,000 / 2,000 | 2,000 / 2,000 | 37 / 2,000 | 37 / 40 |
| `/sync` 200 / 304 | — | — | 943 KiB uncompressed, ~60 ms / ~50 ms |

Track C's slowdown came from every row reading the whole board context: any focus or notice
change re-rendered all rows. The split context and the focus store fixed it. CI budgets: 150 ms
per switch, 16 ms per focus move. Every view now meets the roadmap's 16 ms target locally.

**Timeline virtualization** (`lib/viewport.ts`, shared with the list): only labels and bars near
the viewport are drawn; a dependency arrow is drawn when it crosses the drawn rows, even if one
end is off screen. `J`/`K` scroll the focused row into view. The unscheduled list shows 100 tasks
and a "Show more" button.

## Testing
- `focus-store.test.ts`; `api-tasks.test.ts` checks `viewer.githubLinked` for linked and unlinked users.
- E2E `keyboard.spec.ts` adds: keys and the menu on the Members page; the store survives a round
  trip (focus set on Members is still there on Tasks, with no document request); the write-path
  line; dark mode on and off with the system setting; Read Only sees no write-path line.
- E2E `speed.spec.ts` adds: fewer than 150 rows in the DOM (list and timeline, bars equal labels);
  200 `J` presses on the timeline reach task 200 and keep it in view; 100 `J` presses reach task 300 and
  keep it in view; the `/sync` size and time; `J` latency. The optimistic tests watch the panel's
  Status field and the group counts, because rows move between groups.

## Gotchas
- **The React Compiler treats an object whose method is passed as `ref` as a ref.** Pass the
  methods, not the instance (`task-list.tsx`).
- **A grouped list moves a row when its status changes.** Tests that change status must not look
  for the row where it was.
- **Virtualized rows are not all in the DOM.** Tests count the first rows or use the group header.
- **One E2E flake seen (1 of 3 full runs):** sign-in in `keyboard.spec.ts`'s setup timed out while
  the whole run took 2 minutes instead of 1; no server error or rate limit in the log. Watch CI.
