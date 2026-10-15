# 005 — Better Auth, magic link first, invite-only

Date: 2026-10-15 · Status: Accepted

## Context
Clients have no GitHub account. The owner prefers magic link sign-in. The Mac app also needs
sign-in.

## Decision
- Use Better Auth (a library, not a hosted service).
- Sign-in email carries a magic link **and** a 6-digit code. The link opens the Mac app through a
  custom URL scheme. The code works when the email is open on another device.
- Users can link a GitHub account. Owners and Admins must (007).
- **Superseded in part by 017:** creating an Account follows an instance sign-up setting; joining a
  workspace stays invite-only.
- Invite-only: an Owner or Admin enters an email and a role for one workspace. The invite expires
  after 7 days. No auto-join by email domain in v1.

## Alternatives considered
- **Clerk:** faster setup, but a paid third party per user.
- **GitHub OAuth only:** excludes clients.

## Consequences
- Every deployment needs email sending for sign-in, even with email notifications off (014).
