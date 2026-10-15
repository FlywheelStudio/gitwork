# 008 — Write attribution and the audit log

Date: 2026-10-15 · Status: Accepted

## Context
If one bot account makes every commit, git history loses who changed what. Users without GitHub
still need to write.

## Decision
- **Linked users act as themselves.** The server writes with the user's own GitHub token when that
  account can access the repo.
- **Everyone else writes through the GitHub App:**
  - Each doc save is its own commit with `Co-authored-by: <name> <email>`. Commits stay verified, so
    branches that require signed commits accept them.
  - Issue bodies and comments end with `— <name> via Gitwork`.
- **Review mode:** a per-workspace setting, "Require review for edits from people without GitHub",
  turns bot doc writes into pull requests. Off by default.
- **Audit log:** every write records user, action, workspace, repo, target, and commit SHA or issue
  node ID. Owners and Admins see the full log; others see per-item history. Retention: 1 year by
  default, configurable for self-hosters.

## Alternatives considered
- **Custom commit author per user:** GitHub marks those commits unverified, and branches that
  require signed commits reject them.
- **Pull request for every bot write:** clean history, but every edit waits on review. Kept as the
  optional review mode.

## Consequences
- A trailer email not linked to GitHub shows as plain text with no profile link. The audit log is
  the full record.
