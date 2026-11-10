# 026 — Client store with polled deltas

Date: 2026-11-10 · Status: Accepted (owner) · Builds on 004, 010, 012

## Context
Each view switch renders on the server and runs `listTasks()` again. Linear-class speed needs the
data in the browser.

## Decision
- `GET /api/v1/workspaces/:id/sync` returns everything the viewer may see, filtered by
  `isTaskVisible()`, with an opaque cursor. `?since=<cursor>` returns changes.
- The browser keeps the data in memory and IndexedDB, keyed by user and workspace, cleared on
  sign-out. Views, filters, sort, and search run in the browser.
- The client polls every 5 s while the tab is visible, and on focus. Server push comes later behind
  a decision 004 adapter (SSE on Node, a Durable Object on Cloudflare).
- Leak rules: tombstones only for IDs the client holds; the cursor is opaque; each response carries
  a visibility key, and a change of key drops the client cache.

## Alternatives considered
- **Push first:** two runtime-specific transports before any speed win.

## Consequences
- A `workspace_changes` table, written in the same batch as each cache write.
- The Read Only E2E exit check extends to the sync endpoint, deltas, search, and the cache.
