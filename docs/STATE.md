# State

Last updated: 2026-11-10

## Resume here

- Plan: `docs/roadmap.md` (PR #6), accepted 2026-11-10 with decisions 023–032. Order: live GitHub
  check → self-host v0.1 → speed / keyboard / layout → Linear parity tier 1 → Phase 4 Docs.
- Open PRs: #5 (decisions 020–022, iCloud copies removed), #6 (roadmap), #7 (self-host, Track A).
- **Live GitHub check: still not done.** The session's permission rules block a `cloudflared`
  tunnel. The owner must start the tunnel or allow it. See Chores.
- **iCloud copies files in this repo**, even inside `.git`. Fix: turn off iCloud Desktop & Documents
  sync, or move the whole `~/Documents/Flywheel` tree (not only `gitwork`: CLAUDE.md discovery and
  the `../../conventions` import depend on it) and copy the Claude memory folder to the new path key.
- **Before any work:** `git fetch origin && git status -sb`.
- **Toolchain:** pnpm comes from corepack. Run checks from the repo root:
  `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e && pnpm smoke`.

## In Progress

Track B + C + D (speed, keyboard, layout) — next after PR #7.

## Completed

| Item | Date | Doc |
|---|---|---|
| Product design and decisions 001–015 | 2026-10-15 | [spec.md](spec.md) |
| Phase 0 — Scaffold | 2026-10-15 | [features/scaffold.md](features/scaffold.md) |
| Phase 1 — Identity | 2026-10-15 | [features/identity.md](features/identity.md) |
| Phase 2 — GitHub App (PR #3) | 2026-10-15 | [features/github-app.md](features/github-app.md) |
| Phase 3 — Tasks on web (PR #4) | 2026-10-16 | [features/tasks.md](features/tasks.md) |
| Track A — Self-host release (PR #7, in review; GitHub half of the exit check waits on the live check) | 2026-11-10 | [features/self-host.md](features/self-host.md) |

## Backlog

1. Phase 4 — Docs on web (editor, round-trip fidelity, images, PR fallback, conflicts)
2. Phase 5 — Activity (audit log, history, inbox)
3. Phase 6 — Mac app v1
4. Phase 7 — Ship (Cloudflare button, docker-compose, self-host guide)

Chores:
- **Live GitHub check (approved 2026-10-15, blocked).** Nothing in Phases 2–3 has touched real
  GitHub. The 2026-10-15 attempt stopped at two points: the session may not open a tunnel
  (`cloudflared`), and no browser was connected for GitHub's "Create GitHub App" click. Plan
  without a tunnel: create the App against `localhost` (if GitHub accepts a localhost webhook URL),
  install it on **one selected repo**, then fetch real deliveries with the App JWT
  (`GET /app/hook/deliveries/{id}`) and replay them to the local webhook route, re-signed with the
  stored secret (the API returns parsed JSON, not the signed bytes). Diff real payloads against
  `test/fake-github.ts`; exercise linking and a task write with a real user token.
- Workers bundle is 3.40 MiB gzipped, over the Free plan's 3 MiB (main was already 3.23 MiB).
  Decide: require the Paid plan for Cloudflare, or cut the bundle.
- Owner question (decision 020): should a workspace unlink when the Admin who linked it loses
  GitHub access?
- Before a hosted launch: `/github/installed` should show org names only to users whose GitHub
  token can see the installation (now it shows none).
- Upgrade Next 16.3.8 → 16.4.x with OpenNext ≥1.20.12 once it passes the pnpm age policy.

Later: Mac timeline (1.1), email notifications, live co-editing, API tokens, billing / Agency plan.
