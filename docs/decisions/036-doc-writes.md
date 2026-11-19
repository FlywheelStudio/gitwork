# 036 — Doc writes: one signed commit, conflict check, pull request fallback

Date: 2026-11-19 · Status: Accepted (default; the owner may override) · Builds on 008, 011, 021

## Context
Decision 011 asks for one writer at a time with conflict detection, a pull request when branch
protection blocks a commit, renames in one commit, and images in the same commit as the doc.
Decision 008 asks for verified commits and a Co-authored-by trailer on App writes.

## Decision
- **Every write is one `createCommitOnBranch` call** (GraphQL). GitHub signs it, it takes several
  files at once (doc + images, rename = add + delete), and `expectedHeadOid` refuses to commit on
  top of a head we did not check.
- **User token first, App on refusal** (021). App commits end with
  `Co-authored-by: <name> <email>`.
- **Conflict check before the commit.** The client sends the blob sha it loaded. The server reads
  the file's current sha at the branch head; a different sha is a 409 `doc_conflict` with GitHub's
  current text, and the editor shows a side-by-side merge view.
- **Conflict vs. protection without trusting status codes.** When GitHub refuses the commit, the
  server reads the head again. A moved head is a race: check and try once more. The same head and
  the same file, still refused, means branch protection or a ruleset: the save becomes a pull
  request.
- **Pull request fallback.** A new branch `gitwork/docs-<name>-<random>` at the checked head, the
  same commit there, and a pull request to the docs branch. The doc is "pending review"
  (`doc_pending_prs`): it opens from the PR branch, and later saves commit there. The
  `pull_request` webhook (closed) ends it; a deleted branch found on open also ends it.
- **Review mode (008).** `workspaces.review_bot_doc_edits`: App writes go straight to a pull request.
  A user who linked GitHub still commits as themselves.
- **No empty commits.** The server computes the git blob sha of the new text; equal to the base sha
  with no images means "unchanged", and nothing is sent.
- **Rename and delete** refuse while the doc has an open pull request. Delete needs `docs.delete`.

## Alternatives considered
- **Contents API (`PUT /contents`)** for single files: built-in sha check, but one file per commit,
  so no doc + image commit and no one-commit rename.
- **Treat any 409/422 as a conflict:** GitHub uses those codes for protection, rulesets, and
  stale data alike. Re-reading the file is the only reliable signal.

## Consequences
- The exact error GitHub returns for a protected branch on `createCommitOnBranch` is not verified
  against real GitHub yet (fake GitHub only). The re-read rule does not depend on it. The live
  GitHub check must confirm the PR fallback.
- `createCommitOnBranch` with a 10 MB image is also unverified against real GitHub's request limits.
