# Gitwork — Product Spec (v1)

Working name: **Gitwork**. The name lives in one config constant (decision 015).

## Goal

GitHub is the single source of truth for a project's tasks and knowledge. Nothing lives in ClickUp,
Notion, or Google Docs. Gitwork gives people outside GitHub (clients, stakeholders) a fast, safe view
of that truth, and lets them take part where the team allows it.

Gitwork is open source (AGPL-3.0). Anyone can self-host it anywhere. Flywheel runs a paid hosted
version later.

## Glossary

| Term | Meaning |
|---|---|
| **Account** | A person or an agency. Owns workspaces. Billing attaches here later. |
| **Workspace** | One project. Links exactly one GitHub Projects v2 board and a list of repos. |
| **Board** | The org-owned GitHub Projects v2 board that a workspace links. |
| **Task** | A board item whose issue lives in one of the workspace's repos, or a draft item. |
| **Draft item** | A board item with no repo. Hidden from Read Only unless the workspace setting shows it. |
| **Doc** | A markdown file under a repo's docs folder (default `docs/`). |
| **Linked user** | A user who connected a GitHub account. Acts on GitHub as themselves. |
| **Bot write** | A write the GitHub App makes for a user who has no linked GitHub account. |
| **Hidden item** | An issue with the workspace's hide label, or a file under its hide folder. |

## Settled decisions

Each has a record in `docs/decisions/`.

| # | Decision |
|---|---|
| 001 | Open source, AGPL-3.0. Self-host anywhere; Flywheel hosts a paid version later. No billing in v1. |
| 002 | Standard Next.js. OpenNext adapter for Cloudflare Workers. Not vinext (experimental). |
| 003 | SQLite through Drizzle: D1 on Cloudflare, a SQLite file elsewhere. No Supabase. |
| 004 | Platform services sit behind adapters with a run-anywhere default. |
| 005 | Better Auth. Magic link (link + 6-digit code) first; GitHub account link optional. Invite-only. |
| 006 | Account → Workspace → one board + repo list. Org-owned repos and boards only. |
| 007 | Four fixed roles per workspace. The app role decides what you can do. |
| 008 | Attribution: linked users act as themselves; bot writes carry the user's name. Audit log on every write. |
| 009 | Tasks come from Projects v2. Admin maps fields to views. New tasks are always real issues. |
| 010 | Reads come from a cache that webhooks update. Full reconcile every 15 minutes. |
| 011 | Docs: source-text editor, byte-exact round trip, single writer with conflict detection. |
| 012 | Hide label and hide folder per workspace. Nothing hidden by default, except draft items for Read Only. Server-side filtering. |
| 013 | Native Mac app: AppKit + TextKit 2. v1 = docs, list, kanban. Offline reads and doc drafts. |
| 014 | Notifications: in-app inbox and native macOS notifications. No email notifications in v1. |
| 015 | pnpm monorepo. Versioned REST API `/api/v1` with an OpenAPI spec. |
| 016 | libsql on Node; `batch()` is the only atomic write; build-time driver split. |
| 017 | Better Auth for identity only. GitHub link needed for GitHub tasks only. Sign-up policy is an instance setting. |

## Roles

| Capability | Owner | Admin | Member | Read Only |
|---|---|---|---|---|
| View tasks and docs | ✓ | ✓ | ✓ | ✓ (minus hidden items and draft items) |
| See hidden items | ✓ | ✓ | ✓ | ✗ |
| Comment and file requests | ✓ | ✓ | ✓ | Workspace setting, off by default |
| Create, edit, move tasks | ✓ | ✓ | ✓ | ✗ |
| Create, edit, rename, move docs | ✓ | ✓ | ✓ | ✗ |
| Delete docs | ✓ | ✓ | ✗ | ✗ |
| Invite people | ✓ | ✓ (up to Member) | ✗ | ✗ |
| Workspace settings (repos, board, fields, hiding, review mode) | ✓ | ✓ | ✗ | ✗ |
| Manage Admins, delete workspace | ✓ | ✗ | ✗ | ✗ |
| See full audit log | ✓ | ✓ | ✗ | ✗ |
| **Needs a linked GitHub account** | For GitHub tasks* | For GitHub tasks* | No | No |

\* GitHub tasks: install the App; set the workspace's repos, board, and fields (decision 017).

Account Owners get Owner in every workspace the account owns. One login works across accounts.

## How a write reaches GitHub

1. The server checks the user's app role for the workspace. The role is the authority.
2. If the user has a linked GitHub account with access to the repo, the server writes with the
   user's own token. GitHub shows the user as the author.
3. Otherwise the GitHub App writes:
   - Commits carry `Co-authored-by: <name> <email>`. One save = one commit. Commits stay verified.
   - Issue bodies and comments end with `— <name> via Gitwork`.
4. If the workspace has "Require review for edits from people without GitHub" on, a bot write to a
   doc opens a pull request instead of a commit.
5. If branch protection blocks a direct commit, the server opens a pull request and marks the doc
   "pending review".
6. The audit log records user, action, workspace, repo, target, and commit SHA or issue node ID.

## Architecture

```
apps/web        Next.js (App Router). UI + /api/v1 + GitHub webhooks.
apps/mac        Native macOS app. AppKit shell, TextKit 2 editor. Talks only to /api/v1.
packages/core   Permissions, visibility filter, GitHub sync, attribution, markdown round trip.
packages/db     Drizzle schema (SQLite dialect) + migrations. D1 and SQLite-file drivers.
```

**Adapters (decision 004):**

| Service | Default (anywhere) | Cloudflare |
|---|---|---|
| Database | SQLite file | D1 |
| Email (magic links only) | SMTP | Cloudflare Email |
| Background jobs | In-process queue | Cloudflare Queues |
| Presence ("Jane is editing") | Heartbeat row in DB | Heartbeat row in DB |
| Scheduled reconcile | In-process timer | Cron Trigger |

**GitHub App permissions:** repository Contents (rw), Issues (rw), Pull requests (rw), Metadata (r);
organization Projects (rw), Members (r). **Webhooks:** `issues`, `issue_comment`, `sub_issues`,
`issue_dependencies`, `label`, `push`, `pull_request`, `projects_v2`, `projects_v2_item`,
`installation`, `installation_repositories`.

## Build phases

Each phase ends with passing typecheck, lint, and tests, and a feature doc per the workspace
workflow.

| Phase | Scope | Exit check |
|---|---|---|
| **0. Scaffold** | pnpm monorepo, Next.js + OpenNext, Drizzle + both drivers, Vitest, Playwright, CI, real commands in CLAUDE.md. | `pnpm dev` runs on Node and in `wrangler dev`. CI green. |
| **1. Identity** | Accounts, workspaces, memberships, roles, invites, magic link + code, GitHub account link. Permission matrix in `packages/core`. | A test for every cell of the role matrix. Invite expiry tested. |
| **2. GitHub App** | Setup wizard, App manifest flow, installation, webhook intake (signature check, idempotent), cache tables, 15-minute reconcile. | Replayed webhook changes nothing. Reconcile repairs a dropped event. |
| **3. Tasks (web)** | Board + repo linking, field mapping, list / kanban / timeline, create and edit tasks, attribution, hide filter. | E2E: Read Only user never receives a hidden item or a task from an unlinked repo. |
| **4. Docs (web)** | Doc tree, CodeMirror 6 source editor with live preview, frontmatter panel, images, commit / PR fallback, conflict view, presence. | Round-trip fixture suite: untouched lines stay byte-identical. |
| **5. Activity** | Audit log views, per-item history, in-app inbox. | Audit entry exists for every write path. |
| **6. Mac app** | Sign-in (URL scheme + code), list, kanban, TextKit 2 editor, offline cache and doc drafts, macOS notifications, Sparkle, Homebrew cask, Developer ID signing. | Same round-trip fixture suite passes in Swift. |
| **7. Ship** | Deploy-to-Cloudflare button, `docker-compose.yml`, self-host guide, public repo. | A fresh self-host from the README reaches a working workspace. |

**Later (not v1):** Mac timeline view (1.1), email notifications, live co-editing (CRDT), personal
API tokens, billing and the Agency plan, custom roles, auto-join by email domain, personal-account
repos.

## Risks

- **Projects v2 webhooks are in public preview.** The 15-minute reconcile covers missed or changed
  events. Track GitHub's changelog.
- **Two SQLite drivers.** Resolved in Phase 0 (decision 016): libsql on Node, D1 on Workers, one
  async `Db` type, `batch()` as the only atomic write. CI runs the contract suite on both.
- **Markdown fidelity.** A WYSIWYG editor that re-serializes markdown breaks the byte-exact
  guarantee. Both editors edit source text and hide syntax marks on display, as flo-state does.
- **Installing the GitHub App needs an org owner** (or an approved request). The setup wizard must
  explain this.
- **GitHub secondary rate limit:** about 80 content-creating requests per minute per App. Bot writes
  go through the job queue with backoff.
- **Linked-user tokens.** Mint them through the GitHub App's own user authorization, not a separate
  OAuth App, so their scope stays within the App's permissions. Phase 1 verifies expiry and refresh.
- **Signing of linked-user commits is unverified.** If commits made with a user token are not
  verified, branches that require signed commits reject linked-user writes. Phase 2 tests this and
  falls back to a bot write with a trailer if needed.
- **Reconcile budget.** All workspaces in one org share the installation's GraphQL budget (5,000
  points per hour, up to 12,500). A full reconcile every 15 minutes per workspace can exhaust it for
  an agency. Reconcile must be incremental and budgeted per installation.
- **OpenNext on Workers** has bundle-size and Node-API limits. Phase 0 proves the stack before any
  feature work.
