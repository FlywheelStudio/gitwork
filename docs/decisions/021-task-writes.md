# 021 — Task writes: user token first, App on refusal, synchronous

Date: 2026-10-15 · Status: Accepted (owner confirmed the defaults 2026-10-16) · Builds on 007, 008, 009

## Context
Decision 008 says linked users act as themselves and everyone else writes through the App. Two
details were open: what happens when a linked user's own GitHub account cannot write to the repo,
and whether writes wait in a job queue (the spec's adapter table lists one).

## Decision
- **Per call, user first.** Each GitHub call (create issue, add to board, set a field, edit an
  issue) runs with the user's own token when they linked GitHub. If GitHub refuses it (401, 403,
  404, or a GraphQL FORBIDDEN / NOT_FOUND), that call runs again as the App. Nothing happened on
  GitHub for the refused call, so the retry cannot double-write. The app role is the authority (007).
- **Attribution.** An App-written issue body ends with `— <name> via Gitwork`. When the App edits a
  body again, the trailing attribution line is replaced by the current editor's, never stacked.
  Title and field changes cannot carry attribution on GitHub; the audit log records them.
- **Audit.** Every write adds an `audit_log` row: user, workspace, action, `via` (user / app /
  local), repo, target node id. The "last used repo" default for new tasks comes from it.
- **Synchronous.** Writes call GitHub inside the request. A GitHub rate limit returns 503 with
  `Retry-After`. No job queue in v1.
- **Cache from GitHub's answer.** After a write, the cache stores GitHub's own response (issue JSON,
  item from the mutation), so the UI updates at once without waiting for a webhook.
- **Partial failure.** If the issue is created but adding it to the board fails, the issue is still
  cached and audited (`boardAdd: "failed"`), and the request reports the error.
- **Drafts.** Draft items can move between columns (field changes); their title and body are
  edited on GitHub. New tasks are always real issues (009).

## Alternatives considered
- **Fail when the user's token is refused:** honest about GitHub permissions, but a client with a
  read-only GitHub seat could not use a role Gitwork gave them.
- **Queue every write:** smooths rate limits, but adds a Queues adapter and makes the UI wait for a
  worker. Revisit if 503s show up in practice.

## Consequences
- A linked user's write can show up on GitHub as the App. The audit log says which (`via`).
- A burst of writes can hit GitHub's secondary limit (about 80 content writes a minute per App);
  users then see "try again shortly".
