# 027 — Optimistic edits; bulk edits through the job queue

Date: 2026-11-10 · Status: Accepted (owner) · Amends 021

## Decision
- The client applies an edit at once and rolls it back if the server refuses. `Cmd+Z` undoes the
  last edit.
- A single edit stays synchronous on the server: user token first, then the App (decision 021).
- **Amendment to 021:** bulk edits (many tasks at once) run through the job queue (decision 004),
  paced under GitHub's ~80 writes per minute. Each write still gets its audit row.

## Consequences
- The UI shows bulk progress and per-task failures.
