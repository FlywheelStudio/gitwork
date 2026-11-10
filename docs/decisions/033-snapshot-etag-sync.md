# 033 — Sync by snapshot ETag, not a change table; no IndexedDB yet

Date: 2026-11-10 · Status: Accepted (default; owner may override) · Amends 026

## Context
Decision 026 planned a `workspace_changes` table, an opaque cursor, tombstones for IDs the client
holds, and an IndexedDB cache. Building it showed two problems:
- The cache's `syncedAt` column does not mark every change (`markIssuesDeleted`,
  `setReposAvailable` skip it), so a change table needs a write in every cache path.
- Each leak rule in 026 (tombstones, cursor gaps, stale cache after a role change) exists only
  because of deltas.

## Decision
- `GET /api/v1/workspaces/:id/sync` returns the viewer's whole filtered snapshot
  (`role`, `canWrite`, `board`) with a strong ETag: SHA-256 of the exact bytes this viewer gets.
  With a matching `If-None-Match` it answers 304 and no body.
- Headers: `Cache-Control: private, no-cache` and `Vary: Cookie`, so no proxy shares a snapshot.
- The server-rendered page computes the same bytes and ETag, so the client's first poll is a 304.
- The client polls every 5 s while the tab is visible, and on focus (as 026).
- The browser keeps the snapshot in memory only. **IndexedDB is deferred** until offline use needs
  it (the Mac app has its own cache). This departs from the answer to Q4; the owner may override.

## Why it is safe
A change to an item the viewer cannot see leaves the viewer's bytes, and so the ETag, unchanged:
the poll is a 304, exactly as if nothing happened. A role or hide-setting change changes the bytes,
so the client replaces everything it holds. No tombstones, no cursor, nothing to leak.

## Alternatives considered
- **Change table + cursor (026):** smaller responses on change; more code in every cache write and
  three leak rules to keep right.
- **Per-task hashes, then fetch changed tasks:** a later optimization if snapshots grow large.

## Consequences
- Each poll runs the filtered board query on the server (one join over the board's items). Each
  change sends the whole snapshot. Measured at 2,000 tasks (`e2e/speed.spec.ts`, local Node +
  SQLite): 943 KiB uncompressed, about 60 ms for a 200 and 50 ms for a 304 (the server still builds
  and hashes the snapshot to answer 304).
- Revisit with per-task hashes when boards pass about 5,000 tasks.
