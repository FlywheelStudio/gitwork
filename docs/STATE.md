# State

Last updated: 2026-10-16

## Resume here

- PRs #1–#4 (Phases 0–3) are merged. Next: Phase 4 — Docs on web.
- **Live GitHub check: still not done.** It needs a person (or a connected browser) to click
  "Create GitHub App" on github.com, and a public webhook URL. See Chores.
- **Before any work:** `git fetch origin && git status -sb`.
- **Toolchain:** pnpm comes from corepack (`corepack enable` was run on this machine). Run checks
  from the repo root: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e && pnpm smoke`.

## In Progress

None. Next step: Phase 4 — Docs on web.

## Completed

| Item | Date | Doc |
|---|---|---|
| Product design and decisions 001–015 | 2026-10-15 | [spec.md](spec.md) |
| Phase 0 — Scaffold | 2026-10-15 | [features/scaffold.md](features/scaffold.md) |
| Phase 1 — Identity | 2026-10-15 | [features/identity.md](features/identity.md) |
| Phase 2 — GitHub App (PR #3) | 2026-10-15 | [features/github-app.md](features/github-app.md) |
| Phase 3 — Tasks on web (PR #4) | 2026-10-16 | [features/tasks.md](features/tasks.md) |

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
- `pnpm smoke`: fail when the gzipped Worker bundle passes 10 MiB (decision 022).
- Before a hosted launch: `/github/installed` should show org names only to users whose GitHub
  token can see the installation (now it shows none).
- Upgrade Next 16.3.8 → 16.4.x with OpenNext ≥1.20.12 once it passes the pnpm age policy.

Later: Mac timeline (1.1), email notifications, live co-editing, API tokens, billing / Agency plan.
