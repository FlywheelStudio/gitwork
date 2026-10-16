# 020 — Linking a workspace is checked with the user's own GitHub token

Date: 2026-10-15 · Status: Accepted · Builds on 006, 017

## Context
A workspace links one board and a list of repos (006). The App's installation token can read every
org that installed the App, so the App cannot tell which repos a given Admin should be allowed to
pull in. Without a check, an Admin of one workspace could link another customer's private repo.

## Decision
- An Admin with a linked GitHub account picks an installation, a board, and repos. The picker shows
  only what their **own** token can see.
- On save the server checks again, with the user's token, and trusts nothing from the client:
  - the installation is in `GET /user/installations`, known to us, active, and org-owned;
  - every repo is in `GET /user/installations/{id}/repositories`;
  - the board resolves through `node(id)` and its owner is the installation's org.
- One installation per workspace: the board and all repos come from the same org (006).
- Saving writes the link, the repo list, and `gh_sync_targets`, prunes targets no workspace uses,
  and runs a bounded first sync (3 GitHub pages per target).
- A new board resets the field mapping to auto-detect; changing only repos keeps it.
- Reads never call GitHub. Every task passes the fail-closed filter in
  `packages/core/visibility.ts` (only ISSUE items whose cached issue is in a linked, reachable repo;
  drafts by role and setting; the hide label without case). Parent and "blocked by" links point only
  at tasks the viewer can see.

## Alternatives considered
- **Trust the installation token and the role:** simple, but any Admin could link any repo the App
  reaches.
- **Check once at link time, then re-check on every read:** costs a GitHub call per page view and
  breaks "never call GitHub from a page render".

## Consequences
- The link reflects what the linking Admin could see **when they saved it**. If they later lose
  access, the workspace keeps its repos (the org's installation still covers them). Re-linking
  re-checks. Open question for the owner: should losing access unlink?
- Pull requests on the board are not tasks in v1; they are filtered out like any unknown type.
