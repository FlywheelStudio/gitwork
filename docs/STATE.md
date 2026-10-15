# State

Last updated: 2026-10-15

## In Progress

None. Next step: Phase 2 — GitHub App.

Resolved 2026-10-15: draft items hidden from Read Only by default (006); private convention
import moved to `CLAUDE.local.md`; third-party skills kept out of git.

## Completed

| Item | Date | Doc |
|---|---|---|
| Product design and decisions 001–015 | 2026-10-15 | [spec.md](spec.md) |
| Phase 0 — Scaffold | 2026-10-15 | [features/scaffold.md](features/scaffold.md) |
| Phase 1 — Identity | 2026-10-15 | [features/identity.md](features/identity.md) |

## Backlog

1. Phase 2 — GitHub App (setup wizard, manifest flow, webhooks, cache, reconcile; test the GitHub
   OAuth link callback end to end; setup wizard sets the sign-up default to invite-only)
2. Phase 3 — Tasks on web (list, kanban, timeline, attribution, hide filter)
3. Phase 4 — Docs on web (editor, round-trip fidelity, images, PR fallback, conflicts)
4. Phase 5 — Activity (audit log, history, inbox)
5. Phase 6 — Mac app v1
6. Phase 7 — Ship (Cloudflare button, docker-compose, self-host guide)

Chores:
- Upgrade Next 16.3.8 → 16.4.x with OpenNext ≥1.20.12 once it passes the pnpm age policy.

Later: Mac timeline (1.1), email notifications, live co-editing, API tokens, billing / Agency plan.
