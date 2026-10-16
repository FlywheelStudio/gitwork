# WIP — Phase 3: Tasks on web

Branch `feature/tasks`. Started 2026-10-15.

## Goal
A workspace links one board and its repos. Members see the board's tasks as list, kanban, and
timeline, and create and edit them. Read Only users never receive a hidden item or a task from an
unlinked repo (spec exit check).

## Approach
1. **Link (security boundary).** An Admin with linked GitHub picks an installation, a board, and
   repos. The server re-checks every choice with the user's **own** token: the installation is in
   `GET /user/installations`, each repo is in `GET /user/installations/{id}/repositories`, the
   board resolves through `node(id)` and its owner is the installation's account. All from one
   installation (006). Then it writes `gh_sync_targets` and runs a first bounded sync.
2. **User tokens.** `getAccessToken` refreshes expired App user tokens. A per-user lease in
   `sync_leases` serializes it (two refreshes at once lock the user out).
3. **Reads.** Fail-closed filter in `packages/core/visibility.ts`: only issue items whose issue is
   cached, not deleted, in a linked and available repo; drafts only with `drafts.view`; hide label
   (case-insensitive) only with `items.view_hidden`. Parent and blocked-by links point only at
   tasks the viewer can see.
4. **Writes.** Create (always a real issue in a linked repo, then added to the board), edit title,
   body, state, and board fields. User token first; bot on 403/404 before any side effect. Bot
   bodies end with the attribution line. Cache written from GitHub's response. Audit row per write.
5. **UI.** `/w/[id]` list / kanban / timeline, task detail, workspace settings (link, field
   mapping, hiding). shadcn/ui adopted.

## Files expected to change
`packages/db/src/schema.ts` + migration 0004, `packages/core/src/visibility.ts`,
`packages/server/src/github/{client,queries,cache,webhooks,reconcile}.ts`,
`packages/server/src/services/{link,tasks,audit}.ts`, `packages/server/src/github/user-token.ts`,
`packages/server/src/api/routes.ts`, `apps/web/src/app/w/[workspaceId]/**`, tests, e2e.

## Build log
- 2026-10-15: PR #3 merged. Live GitHub check deferred: the session could not open a tunnel
  (permission denied) and no browser was connected for the App manifest click. See STATE.
- Confirmed against GitHub's live GraphQL schema (introspection): `Issue.parent`, `Issue.blockedBy`,
  `Issue.blocking`, `addProjectV2ItemById`, `updateProjectV2ItemFieldValue`,
  `clearProjectV2ItemFieldValue` exist.

## Open questions
- None blocking. Product defaults are recorded as decisions and listed in the PR.
