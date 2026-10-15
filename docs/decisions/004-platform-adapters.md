# 004 — Platform services behind adapters

Date: 2026-10-15 · Status: Accepted

## Context
Gitwork runs on Cloudflare and on plain Node (001, 002).

## Decision
The core runs on plain Node. Each platform service sits behind a small interface:

| Service | Default | Cloudflare adapter |
|---|---|---|
| Database | SQLite file | D1 |
| Email (magic links) | SMTP | Cloudflare Email |
| Background jobs | In-process queue | Cloudflare Queues |
| Scheduled reconcile | In-process timer | Cron Trigger |
| Presence | Heartbeat row in DB | Heartbeat row in DB |

## Alternatives considered
- **Cloudflare-only (Durable Objects, Queues everywhere):** simplest code, but locks self-hosters in.

## Consequences
- No Durable Objects in v1. Presence uses a heartbeat row with a short expiry.
- Live co-editing (later) will need a new realtime adapter.
