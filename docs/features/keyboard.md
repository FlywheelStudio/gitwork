# Keyboard and command menu

Shipped 2026-11-10 (roadmap Track C). Branch `feature/keyboard`, on top of Track B. Decision 028.

## What it does
- **Every action has keys, and every key is in the menu.** `mod+K` opens the command menu: search
  tasks, or run any command, each listed with its keys. `?` shows the full shortcut sheet.
- **Keys follow Linear.** `C` new task; `J`/`K` (or arrows) move; `X` selects; `Shift+J`/`Shift+K`
  extend; `mod+A` selects all; `Space` opens the side panel (it follows `J`/`K`); `Enter` opens the
  task page; `Esc` closes the panel, then clears the selection, then the focus.
- **Edit keys** act on the selection, else the focused task, else the open panel: `S` status, `P`
  priority, `E` estimate, `Shift+D` due date, `Shift+C` cycle, `mod+Shift+X` close / reopen.
  Pickers are filterable menus; dates and numbers open a one-field dialog.
- **Bulk edits** run one task after another (GitHub rate limits), with progress in the notice bar,
  and undo as one step (`mod+Z`).
- **Copy**: `mod+.` ID (`org/repo#12`), `mod+Shift+,` Gitwork URL, `mod+Shift+.` branch name
  (`12-title-slug`, GitHub's style).
- **Navigation**: `G` then `S` (settings). Tasks and Members are in the command menu. `G` then
  `I` / `M` / `T` / `V` stay free for Inbox / My tasks / Triage / Views (Linear's meanings); a test
  keeps every reserved key (`RESERVED` in keymap.ts) unbound until its page exists.
  **Views**: `mod+B` list ↔ board; `V` then `L` / `B` / `T`.
- Read Only: reading keys work; edit keys show "Your role cannot edit tasks." and send nothing.

## How it works

| File | Role |
|---|---|
| `packages/core/src/keymap.ts` | `COMMANDS` (id, label, keys, scope, group), `createMatcher()` (chords and two-key sequences, 1 s), `chordOf()`, `displayBinding()`. Shared with the Mac app. |
| `apps/web/src/lib/keyboard.ts` | `useShortcuts(handlers, scopes)`: one window listener; typing guard; modal guard. |
| `apps/web/src/app/w/[workspaceId]/command-layer.tsx` | Handlers, the command menu (cmdk), pickers, value dialog, shortcut sheet, selection bar. |
| `apps/web/src/app/w/[workspaceId]/board-context.tsx` | Focus, selection, on-screen order (`setOrder`/`getOrder`), `setFieldMany()`. |
| `apps/web/src/app/w/[workspaceId]/tasks/task-views.tsx` | Rows and cards carry `data-task-id`, focus ring, selection checkbox; each view registers its order. |

**Field roles.** Status = the kanban field. Priority = a single-select named "Priority". Estimate =
a number field named "Estimate", "Points", or "Story points". Due = the target-date mapping.
Cycle = the iteration mapping. A missing field gives a notice, not a silent no-op.

**Scopes.** `task` keys match only when something is focused, selected, or open; otherwise their
letters stay free. The most specific active scope wins.

**Guards.** Keys typed in an input, textarea, select, or editor stay there, except commands marked
`inInputs` (`mod+K`, `Escape`). While a modal is open, only `mod+K` applies.

## Testing
- `keymap.test.ts`: no two commands share keys in one scope (**proven red** with a duplicate); no
  command takes a reserved key;
  unique ids; no sequence start is also a single key; only modifier chords and Escape fire in
  inputs; platform modifiers; shifted punctuation (`mod+Shift+.` arrives as `>`); sequences and
  their timeout; scopes; display strings.
- E2E `keyboard.spec.ts` (15 tests, one per shortcut group): the sheet; focus movement and the
  panel following it; Enter; selection keys; `S` single and bulk with one-step undo; `P`, `E`,
  `Shift+D`, `Shift+C` with the exact PATCH bodies; close / reopen; the three copy keys (clipboard);
  the menu running a command and finding a task; `/` search; view keys; `G` then `S`, a reserved
  `G` then `M` doing nothing, and Members from the menu; `C`; the
  typing guard with a positive control; Read Only sends no write.

## Gotchas
- **A closing dialog keeps focus and its dismiss layer** for its exit animation. Radix calls
  `preventDefault` on Escape, and keys land in the dead input. `close()` blurs the input, and Escape
  runs whenever no modal is open, even if prevented.
- **Turning cmdk filtering on mid-typing keeps the old selection.** Filtering is always on.
- **The React Compiler forbids writing a ref from context.** Views call `setOrder()`.
- **A native `<select>` has `role="option"` children.** Scope E2E picker assertions to the dialog.
- **Bulk edits are client-side and sequential**, each a normal synchronous write (decision 021).
  The server job queue from decision 027 is not built yet; the client loop paces itself by waiting
  for each answer.
