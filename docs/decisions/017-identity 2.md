# 017 — Identity model, GitHub gate, sign-up policy

Date: 2026-10-15 · Status: Accepted · Narrows 007 · Supersedes part of 005

## Context
Phase 1 builds sign-in, accounts, workspaces, roles, and invites. Three questions came up: what
Better Auth should own, which Owner/Admin capabilities need a linked GitHub account, and who may
create a new Account.

## Decision
- **Better Auth owns identity only:** users, sessions, verification codes, linked GitHub identities.
  Gitwork owns accounts, account owners, workspaces, memberships, and invites in its own tables.
  Better Auth's `organization` plugin is not used. Better Auth's "account" model is stored as
  `auth_identities` so it never collides with Gitwork's Account.
- **GitHub gate (owner decision):** a linked GitHub account is needed only for GitHub tasks —
  installing the App and setting a workspace's repos, board, and fields. Owners and Admins can
  invite, manage members, and change other settings without GitHub. The gated set is one constant,
  `GITHUB_CAPABILITIES`, in `packages/core`.
- **Sign-up policy (owner decision):** an instance setting, `open` or `invite-only`. Default `open`
  until the Phase 2 setup wizard exists; then self-host defaults to `invite-only` and the hosted
  version stays `open`. A person with a valid pending invite can always sign up. Joining a
  workspace always needs an invite.

## Alternatives considered
- **Better Auth `organization` plugin:** has roles and invites, but no Account level above
  workspaces and no GitHub gate.
- **Gate all Owner/Admin power on GitHub:** a new Owner could not invite anyone before linking.
- **Always open / always invite-only sign-up:** the first suits hosting but not private installs;
  the second leaves the hosted version no way to onboard customers.

## Consequences
- Every permission check calls `packages/core`; the matrix tests cover the gate.
- The sign-up check is a hook before user creation, not Better Auth's global `disableSignUp`, which
  would lock out invitees.
