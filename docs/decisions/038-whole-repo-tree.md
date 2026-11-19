# 038 — Docs show each repo's whole tree, loaded automatically

Date: 2026-11-19 · Status: Accepted (owner: "I want the repos to have folders. Then I want to see the
regular structure that's in the repo itself.") · Supersedes the "files outside the folder are not
shown" part of 011, and the default folder in 035 · **Default superseded by 039** (docs/ again; the
whole repo stays an option)

## Context
Phase 4 showed only each repo's `docs/` folder, and a repo that had not synced yet waited for a
"Load from GitHub" button. The owner asked for all docs to load on their own, with each repo as a
folder holding the repo's real structure.

## Decision
- **Each repo is a top-level folder** in the Docs tree; inside it, the repo's own folders and files.
- **The default root is the whole repo** (`workspace_repos.docs_path = ""`). An Admin can still narrow
  a repo to one folder (Settings → Docs folders). Linking writes `""` for new repos and keeps the
  setting of repos that stay linked. Migration 0006 moves rows on the old default (`docs`) to `""`.
- **Every tracked file is listed** (up to 5,000 per repo). Markdown opens in the editor; images open
  inline and other files download, both through the access-checked proxy.
- **Automatic loading.** Linking, push webhooks, and reconcile keep the tree current, as before. A
  repo that never synced loads when anyone opens Docs: the tree calls `POST docs/refresh`, which any
  member may call and which skips repos already synced.
- **The hide folder counts from the root** (the repo root by default): `docs/internal` hides
  `docs/internal/`.
- **Pasted images go to `assets/` next to the doc.**

## Alternatives considered
- **Gitwork-only folders stored in the database:** the owner chose the repo's own structure.
- **Markdown files only:** hides the structure the owner asked to see.

## Consequences
- Read Only members see every file name in a linked repo, code included, unless the hide folder
  covers it. Admins who link code repos for clients should set a hide folder or narrow the root.
- Repos with more than 5,000 files show a "more files than Gitwork lists" note.
- The SQL default of `docs_path` stays `'docs'` (SQLite cannot change a default without rebuilding
  the table); every write sets the value explicitly.
