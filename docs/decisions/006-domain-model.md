# 006 — Account → Workspace → one board + repo list; org-owned only

Date: 2026-10-15 · Status: Accepted

## Context
A client project usually spans several repos (iOS, web, backend). The owner wants each workspace to
be one project, and an Agency plan with unlimited workspaces. A GitHub App cannot reach Projects v2
boards owned by a personal account.

## Decision
- An **Account** (person or agency) owns workspaces. Account Owners get Owner in every workspace of
  the account.
- A **Workspace** is one project. It links exactly one org-owned Projects v2 board and a list of
  repos that an Admin picks.
- Tasks = board items whose issues live in the workspace's repos, plus draft items (hidden from
  Read Only by default; see Consequences). Items from other
  repos on the same board are filtered out on the server.
- Docs come from the docs folder of each repo in the list.
- One login works across accounts. Roles are set per workspace.
- Repos and boards owned by personal accounts are unsupported in v1, with a clear message.

## Alternatives considered
- **Project = one repo:** does not fit multi-repo client work.
- **Workspace connects many orgs:** a board belongs to one org, so no v1 need.

## Consequences
- The repo filter is a security boundary: a shared board must never leak a private repo.

- Draft items have no repo and no labels, so neither the repo filter nor the hide label (012) can
  catch them. Read Only users do not see draft items by default. A workspace setting, "Show draft
  items to Read Only", turns them on. (Resolved 2026-10-15.)
