# 030 — Assignees are GitHub users only

Date: 2026-11-10 · Status: Accepted (owner)

## Decision
Only GitHub users can be assignees (GitHub issue assignees). Members without a linked GitHub
account follow tasks instead, and see them in My tasks and the inbox.

## Alternatives considered
- **A local assignee field:** data GitHub cannot hold; breaks the source-of-truth rule.

## Consequences
- The assignee picker lists the org's members that can be assigned to the repo.
