# 010 — Cache updated by webhooks; reconcile every 15 minutes

Date: 2026-10-15 · Status: Accepted

## Context
Clients must not spend the App's GitHub rate limit. Projects v2 webhooks are in public preview and
can miss or change events.

## Decision
- Serve every read from the app's cache.
- Webhooks update the cache. The handler verifies the signature and is idempotent on delivery ID.
- A full reconcile against GitHub runs every 15 minutes per workspace.
- Admins get a "Refresh" button.

## Alternatives considered
- **Live reads from GitHub:** always fresh, but slow and rate-limited.

## Consequences
- Writes update the cache optimistically, then the webhook confirms.
