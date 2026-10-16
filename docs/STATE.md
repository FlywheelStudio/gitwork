# State

Last updated: 2026-10-15

## Resume here

- **Phase 2 is in review:** [PR #3](https://github.com/FlywheelStudio/gitwork/pull/3), branch
  `feature/github-app`, CI green, **not merged**. PRs #1 (Phase 0) and #2 (Phase 1) are merged.
- **Waiting on the owner (ask, do not assume):**
  1. Merge PR #3? (The owner approves each merge separately.)
  2. Run the live GitHub check? It creates a test GitHub App in the FlywheelStudio org — outward
     facing, needs an explicit yes. See Chores.
  3. Start Phase 3 (tasks on web)? Begin with the security boundary below.
- **Before any work:** `git fetch origin && git status -sb`. If PR #3 was merged, branch Phase 3
  from an up-to-date `main` as `feature/tasks`.
- **Toolchain:** pnpm comes from corepack (`corepack enable` was run on this machine). Run checks
  from the repo root: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e && pnpm smoke`.

## In Progress

None. Next step: Phase 3 — Tasks on web.

Resolved 2026-10-15: draft items hidden from Read Only by default (006); private convention
import moved to `CLAUDE.local.md`; third-party skills kept out of git.

## Completed

| Item | Date | Doc |
|---|---|---|
| Product design and decisions 001–015 | 2026-10-15 | [spec.md](spec.md) |
| Phase 0 — Scaffold | 2026-10-15 | [features/scaffold.md](features/scaffold.md) |
| Phase 1 — Identity | 2026-10-15 | [features/identity.md](features/identity.md) |
| Phase 2 — GitHub App (in review: PR #3, not merged) | 2026-10-15 | [features/github-app.md](features/github-app.md) |

## Backlog

1. Phase 3 — Tasks on web (list, kanban, timeline, attribution, hide filter; link a board and repos
   to a workspace → sync targets; serialize user-token refresh per user; apply sub_issues /
   issue_dependencies; adopt shadcn/ui)
2. Phase 4 — Docs on web (editor, round-trip fidelity, images, PR fallback, conflicts)
3. Phase 5 — Activity (audit log, history, inbox)
4. Phase 6 — Mac app v1
5. Phase 7 — Ship (Cloudflare button, docker-compose, self-host guide)

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
