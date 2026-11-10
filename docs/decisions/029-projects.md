# 029 — A Linear project is a board field plus a doc

Date: 2026-11-10 · Status: Accepted (owner) · Keeps 006

## Decision
- A workspace keeps one board (decision 006).
- A "project" is an option of a board single-select field named "Project" (auto-detected like
  Status), plus `docs/projects/<slug>.md` in a linked repo for description, lead, status, and
  target date (frontmatter).

## Alternatives considered
- **Several boards per workspace:** breaks decision 006 and multiplies sync cost.
- **Repo milestones:** scoped to one repo.

## Consequences
- Project pages wait for Phase 4 (Docs).
