# State

Last updated: 2026-11-10

## Resume here

- PRs #5–#11 are on `main` (2026-11-10). #9 and #10 landed through #11. Plan: `docs/roadmap.md`,
  decisions 023–033.
- **Next: first deploy to Cloudflare** (owner approved 2026-11-10: Cloudflare for hosting and
  email; instance admins `erikgoins@gmail.com`, `erik@flywheel.so`). Steps in
  `docs/self-host/README.md` → Cloudflare. Waiting on the owner for: `wrangler login`, the Workers
  Paid plan, and a domain onboarded to Cloudflare Email Service. The deploy doubles as the live
  GitHub check: a public URL, no tunnel.
- **iCloud copies files in this repo**, even inside `.git`. Fix: turn off iCloud Desktop & Documents
  sync, or move the whole `~/Documents/Flywheel` tree (not only `gitwork`: CLAUDE.md discovery and
  the `../../conventions` import depend on it) and copy the Claude memory folder to the new path key.
- **Before any work:** `git fetch origin && git status -sb`.
- **Toolchain:** pnpm comes from corepack. Run checks from the repo root:
  `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e && pnpm smoke`.

## In Progress

First Cloudflare deploy (blocked on the owner's account steps, above).

## Completed

| Item | Date | Doc |
|---|---|---|
| Product design and decisions 001–015 | 2026-10-15 | [spec.md](spec.md) |
| Phase 0 — Scaffold | 2026-10-15 | [features/scaffold.md](features/scaffold.md) |
| Phase 1 — Identity | 2026-10-15 | [features/identity.md](features/identity.md) |
| Phase 2 — GitHub App (PR #3) | 2026-10-15 | [features/github-app.md](features/github-app.md) |
| Phase 3 — Tasks on web (PR #4) | 2026-10-16 | [features/tasks.md](features/tasks.md) |
| Track A — Self-host release (PR #7; the GitHub half of the exit check waits on the live check) | 2026-11-10 | [features/self-host.md](features/self-host.md) |
| Track B — Speed foundation (PR #8) | 2026-11-10 | [features/speed.md](features/speed.md) |
| Track C — Keyboard and command menu (PR #9) | 2026-11-10 | [features/keyboard.md](features/keyboard.md) |
| Track D — App shell and clear UI (PR #10) | 2026-11-10 | [features/shell.md](features/shell.md) |
| Timeline virtualization, roadmap B6 (PR #11) | 2026-11-10 | [features/shell.md](features/shell.md) |

## Backlog

Order: `docs/roadmap.md` (decisions 023–033).

0. Live GitHub check on the deployed instance (gate for Track E and Phase 4).
1. Track E tier 1 — Triage, My tasks, priority/estimate/labels/assignees edits, comments, saved
   views, inbox (merges Phase 5).
2. Phase 4 — Docs on web (editor, round-trip fidelity, images, PR fallback, conflicts)
3. Phase 6 — Mac app v1
4. Deploy to Cloudflare button (needs the app isolated in one folder; see features/self-host.md)

Chores:
- **Server job queue for bulk edits (decision 027).** Bulk edits run in the browser, one by one,
  for now (features/keyboard.md). Build the queue (decision 004 adapter) before bulk edits grow.
- Before a hosted launch: `/github/installed` should show org names only to users whose GitHub
  token can see the installation (now it shows none).
- Upgrade Next 16.3.8 → 16.4.x with OpenNext ≥1.20.12 once it passes the pnpm age policy.

Later: Mac timeline (1.1), email notifications, live co-editing, API tokens, billing / Agency plan.
