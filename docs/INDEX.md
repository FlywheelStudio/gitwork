# Docs Index

| Doc | Description |
|---|---|
| [STATE.md](STATE.md) | Status board: in progress, completed, backlog. |
| [spec.md](spec.md) | v1 product spec: glossary, roles, write path, architecture, build phases, risks. |

## Decisions

| # | Record |
|---|---|
| 001 | [Open source under AGPL-3.0; self-host anywhere](decisions/001-open-source-agpl.md) |
| 002 | [Standard Next.js with OpenNext, not vinext](decisions/002-nextjs-opennext.md) |
| 003 | [SQLite through Drizzle (D1 / SQLite file)](decisions/003-sqlite-drizzle.md) |
| 004 | [Platform services behind adapters](decisions/004-platform-adapters.md) |
| 005 | [Better Auth, magic link first, invite-only](decisions/005-auth-magic-link.md) |
| 006 | [Account → Workspace → board + repos; org-owned only](decisions/006-domain-model.md) |
| 007 | [Four fixed roles; the app role is the authority](decisions/007-roles.md) |
| 008 | [Write attribution and the audit log](decisions/008-write-attribution.md) |
| 009 | [Tasks from Projects v2; field mapping](decisions/009-tasks-projects-v2.md) |
| 010 | [Webhook cache with 15-minute reconcile](decisions/010-sync-cache.md) |
| 011 | [Docs editing model](decisions/011-docs-editing.md) |
| 012 | [Hidden items for Read Only users](decisions/012-visibility-filter.md) |
| 013 | [Native Mac app](decisions/013-native-mac-app.md) |
| 014 | [Notifications without email in v1](decisions/014-notifications.md) |
| 015 | [pnpm monorepo, versioned REST API, working name](decisions/015-monorepo-api.md) |
| 016 | [libsql on Node, batch-only atomic writes, build-time driver split](decisions/016-db-driver-and-atomic-writes.md) |
| 017 | [Identity: Better Auth for identity only; GitHub gate; sign-up policy](decisions/017-identity.md) |
| 018 | [Everyone in a workspace sees all members' names and emails](decisions/018-member-list-visibility.md) |

## Features

| Doc | Description |
|---|---|
| [features/scaffold.md](features/scaffold.md) | Monorepo, D1 + libsql behind one `Db` type, build-time driver split, tests, CI. |
| [features/identity.md](features/identity.md) | Email-code sign-in, accounts, workspaces, roles, invites, GitHub link, `/api/v1`. |
