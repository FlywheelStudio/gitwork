# 007 — Four fixed roles; the app role is the authority

Date: 2026-10-15 · Status: Accepted

## Context
The owner wants "what each role can do" to be clear, and wants the team to decide what each client
can do by choosing the client's role.

## Decision
Roles are Owner, Admin, Member, Read Only, set per workspace. No custom roles in v1. The full
matrix lives in `docs/spec.md` → Roles. Key rules:

- Owner and Admin need a linked GitHub account, because they install the App and pick org repos
  and boards. **Narrowed by 017:** only those GitHub tasks need the link.
- Member and Read Only do not need GitHub.
- Read Only can comment and file requests only when the workspace setting allows it (off by
  default).
- Admins can invite up to Member. Only Owners manage Admins and delete a workspace.
- Members can create, edit, rename, and move docs. Delete needs Admin.
- **The app role decides what a user can do. GitHub only decides whose name goes on the change.**
  If a linked user's GitHub account lacks access to a repo, the write goes through the App bot
  with the user's name (008).

## Alternatives considered
- **GitHub permission has the final say for linked users:** linking GitHub would then remove power
  from some Members, and people would learn not to link. Rejected.

## Consequences
- Every cell of the matrix gets a test in `packages/core`.
