# 039 — Each repo shows its docs/ folder by default

Date: 2026-11-19 · Status: Accepted (owner: "show only docs by default.") · Supersedes the default in 038

## Context
Decision 038 made the whole repo the default root. The owner wants only each repo's `docs/` folder
shown and the rest of the files hidden.

## Decision
- **A newly linked repo shows `docs/`.** The tree keeps 038's shape: the repo is the top folder, with
  `docs/`'s own folders inside it. Files outside `docs/` are not in the tree, the API, or reachable
  by URL (`isDocVisible`).
- **"Whole repo" stays an option per repo.** An Admin clears the folder in Settings → Docs folders.
  Any other folder also works.
- **Migration 0007** moves rows on the 0006 default (`""`) back to `docs`. Production had no linked
  repos, so no one had chosen the whole repo on purpose.
- Everything else in 038 stays: automatic loading, relinking keeps settings, images go to `assets/`
  next to the doc. The hide folder counts from the docs folder again (`internal` hides
  `docs/internal/`).

## Alternatives considered
- **Markdown files only in the tree:** offered; not chosen. Every file under `docs/` shows, images
  included.

## Consequences
- A repo without a `docs/` folder shows "Nothing on this branch yet. Create a doc to start it."
