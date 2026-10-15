# 003 — SQLite through Drizzle (D1 on Cloudflare, SQLite file elsewhere)

Date: 2026-10-15 · Status: Accepted

## Context
`conventions/saas-web.md` defaults to Supabase. The owner wants no third-party services that the
product does not need. Self-hosters choose their host (001).

## Decision
Use the SQLite dialect through Drizzle ORM. On Cloudflare, use D1. Elsewhere, use a SQLite file.
One schema and one migration set serve both.

## Alternatives considered
- **Postgres (Supabase hosted, any Postgres self-hosted, Hyperdrive on Cloudflare):** better under
  heavy write load, but adds a service to every deployment.
- **Supabase with RLS:** RLS adds little, because the server mediates every read and write.

## Consequences
- Deviates from `conventions/saas-web.md` (Supabase). This record is the justification.
- `packages/db` exposes one async interface over both drivers. CI runs the suite on both.
- Data is small: users, roles, workspaces, audit log, GitHub cache. D1's per-database size limit is
  not a near-term concern; per-account databases remain an option.
