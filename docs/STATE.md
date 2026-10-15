# State

Last updated: 2026-10-15

## In Progress

None. Next step: Phase 1 — Identity.

Resolved 2026-10-15: draft items hidden from Read Only by default (006); private convention
import moved to `CLAUDE.local.md`; third-party skills kept out of git.

## Completed

| Item | Date | Doc |
|---|---|---|
| Product design and decisions 001–015 | 2026-10-15 | [spec.md](spec.md) |
| Phase 0 — Scaffold (CI written, not yet run: no remote) | 2026-10-15 | [features/scaffold.md](features/scaffold.md) |

## Backlog

1. Phase 1 — Identity (accounts, workspaces, roles, invites, magic link, GitHub link)
2. Phase 2 — GitHub App (setup wizard, manifest flow, webhooks, cache, reconcile)
3. Phase 3 — Tasks on web (list, kanban, timeline, attribution, hide filter)
4. Phase 4 — Docs on web (editor, round-trip fidelity, images, PR fallback, conflicts)
5. Phase 5 — Activity (audit log, history, inbox)
6. Phase 6 — Mac app v1
7. Phase 7 — Ship (Cloudflare button, docker-compose, self-host guide)

Chores:
- Create the public GitHub repo and confirm CI passes there.
- Upgrade Next 16.3.8 → 16.4.x with OpenNext ≥1.20.12 once it passes the pnpm age policy.

Later: Mac timeline (1.1), email notifications, live co-editing, API tokens, billing / Agency plan.
