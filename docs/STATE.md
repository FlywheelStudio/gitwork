# State

Last updated: 2026-10-15

## Resume here

- **Phase 3 (tasks on web) is in progress** on branch `feature/tasks`. WIP doc:
  [wip/tasks.md](wip/tasks.md). PRs #1–#3 (Phases 0–2) are merged.
- **Live GitHub check: still not done.** It needs a person (or a connected browser) to click
  "Create GitHub App" on github.com, and a public webhook URL. See Chores.
- **Before any work:** `git fetch origin && git status -sb`.
- **Toolchain:** pnpm comes from corepack (`corepack enable` was run on this machine). Run checks
  from the repo root: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e && pnpm smoke`.

## In Progress

| Feature | Step | Blockers | Doc |
|---|---|---|---|
| Phase 3 — Tasks on web | Building | None | [wip/tasks.md](wip/tasks.md) |

## Completed

| Item | Date | Doc |
|---|---|---|
| Product design and decisions 001–015 | 2026-10-15 | [spec.md](spec.md) |
| Phase 0 — Scaffold | 2026-10-15 | [features/scaffold.md](features/scaffold.md) |
| Phase 1 — Identity | 2026-10-15 | [features/identity.md](features/identity.md) |
| Phase 2 — GitHub App (PR #3) | 2026-10-15 | [features/github-app.md](features/github-app.md) |

## Backlog

1. Phase 4 — Docs on web (editor, round-trip fidelity, images, PR fallback, conflicts)
2. Phase 5 — Activity (audit log, history, inbox)
3. Phase 6 — Mac app v1
4. Phase 7 — Ship (Cloudflare button, docker-compose, self-host guide)

Phase 3 security boundary (must): when a workspace links a board or repos, check with the linking
user's **own** GitHub token (e.g. `GET /user/installations`, repo/board access) before creating
sync targets. The App's installation token can read every org that installed it; without this
check an Admin could pull another customer's private repos into their workspace.

Chores:
- **Live GitHub check (needs owner approval: creates an App in a GitHub org).** Tunnel a local
  instance, run `/setup`, install the App, receive real webhooks (incl. `projects_v2_item`), run
  reconcile. Nothing in Phase 2 has touched real GitHub yet.
- Before a hosted launch: `/github/installed` should show org names only to users whose GitHub
  token can see the installation (now it shows none).
- Upgrade Next 16.3.8 → 16.4.x with OpenNext ≥1.20.12 once it passes the pnpm age policy.

Later: Mac timeline (1.1), email notifications, live co-editing, API tokens, billing / Agency plan.
