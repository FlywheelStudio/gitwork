# WIP — Phase 1: Identity

Branch: `feature/identity`

## Goal
People can sign in by email code or link, create an Account and its first workspace, invite others
with a role, and link a GitHub account. Every cell of the role matrix (spec → Roles) has a test.

## Approach

**Auth (Better Auth, identity only).** Better Auth owns users, sessions, verification records, and
linked OAuth identities. Gitwork owns accounts, workspaces, memberships, and invites (decision 017).
- Sign-in: Better Auth `emailOTP` plugin, `storeOTP: "hashed"`. One email carries the 6-digit code
  **and** a link that embeds the same code in the URL fragment (`/sign-in/verify#email=…&code=…`).
  The page shows "Continue as jane@…" and POSTs the code on click. **Never verify on GET:** email
  link scanners fetch every link and would burn the code. The fragment never reaches server logs.
  The Mac app (Phase 6) uses the same link with its URL scheme.
- Rate limits for code requests must be stored in the database, not in memory: Worker isolates do
  not share memory.
- Sessions: cookie for the web. Bearer plugin for the Mac app (Phase 6).
- GitHub link: Better Auth GitHub provider with the **GitHub App's** client ID and secret
  (user-to-server tokens). Link only: the provider can never create a user. The GitHub email may
  differ from the sign-in email. Unique index on `(provider_id, account_id)`. Encrypt tokens at rest
  if Better Auth supports it. Phase 1 reads them from env; Phase 2's setup wizard moves them to
  `instance_settings`. Token refresh is verified in Phase 2, when tokens are first used.
- Better Auth is created per request (D1 bindings are per request).
- Table names: `users`, `sessions`, `auth_identities` (Better Auth's "account" model, renamed so it
  never collides with Gitwork's Account), `verifications`.

**Domain tables.** `accounts`, `account_owners`, `workspaces`, `workspace_members`, `invites`.

**Permissions (`packages/core`).** Pure functions over plain data:
- `effectiveRole({ memberRole, isAccountOwner })` — Account Owners are Owner in every workspace of
  the account.
- `GITHUB_CAPABILITIES` — the only capabilities that need a linked GitHub account: install the App,
  set repos, board, and fields. Everything else Owners and Admins can do without GitHub (decision
  017, owner decision 2026-10-15).
- `can(role, capability, settings)` — the matrix, table-driven.
- `invitableRoles(role)` — Owner: all roles; Admin: Member and Read Only.

**Atomic writes.** Account + owner + workspace creation and invite acceptance are single
`db.batch()` calls (decision 016). A batch is all-or-nothing on *errors*, not conditional, so every
guard lives inside the statement it protects:
- Invite acceptance inserts the membership with `INSERT … SELECT … FROM invites WHERE token_hash = ?
  AND email = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?`. The role comes
  from the invite row, never the request. Then `UPDATE invites SET accepted_at` with the same guard.
- "The last Owner cannot be removed" is a guard in the `DELETE … WHERE`.
- Emails are stored and compared in lowercase.

**Invites.** Token is random (32 bytes); only its SHA-256 hash is stored. Expires after 7 days.
Accepting requires being signed in as the invited email.

**Email adapter (decision 004).** `EmailSender` interface:
- `console` (dev only): logs the message. `outbox` (tests only, Node only): appends JSON lines to a
  file. In production with no adapter configured, sending fails; it never falls back to logging.
- `smtp` (Node only, nodemailer) — kept out of the Worker bundle by the same build-time split.
- `cloudflare` (Workers): `send_email` binding named `EMAIL`.

**Sign-up policy.** Instance setting `signups`: `open` or `invite-only` (owner decision 2026-10-15).
Default `open` until the Phase 2 setup wizard exists; then self-host defaults to `invite-only`.
A user-create hook allows a new user when sign-ups are open **or** a valid pending invite exists for
that email. `disableSignUp` is not used: it is global and would lock out invitees.

**CSRF.** Cookie-authenticated POST/PATCH/DELETE on `/api/v1` require a same-origin `Origin` or
`Sec-Fetch-Site`. Bearer-token requests are exempt.

**API.** `/api/v1/me`, `/api/v1/accounts`, `/api/v1/workspaces`, `/api/v1/workspaces/:id/members`,
`/api/v1/workspaces/:id/invites`, `/api/v1/invites/:token/accept`. The web UI calls the same
service functions in `apps/web/src/server/services/`.

**UI.** Sign-in (email → code), onboarding (create Account + first workspace), workspace members
page (list, invite, change role, remove), invite acceptance, settings → link GitHub.

## Build order
1. Permission core (pure, fast tests).
2. Spike: Better Auth sign-in through `auth.api` on libsql **and** D1. Check the Drizzle adapter for
   `transaction()` use; check rate-limit storage.
3. Domain schema + services + guards, tested on both drivers.
4. API routes, then UI, then E2E.

## Tests
- Role matrix: every role × capability, plus the no-GitHub downgrade and the Read Only comment
  setting (unit).
- Services on both drivers: account creation is atomic; invite accept is idempotent, rejects
  expired/revoked/wrong-email (asserting no membership row exists); role changes respect
  `invitableRoles`; last Owner cannot be removed.
- Sign-in on both drivers; rate limit trips; sign-up hook allows invitees under `invite-only`.
- API: cross-site cookie write gets 403.
- API: success, unauthenticated (401), forbidden (403), validation (400) per route.
- E2E: sign in with code from the outbox → create account → invite → second user accepts.

## Open questions
None.

## Build log
- 2026-10-15: Owner decisions: GitHub gate covers GitHub tasks only; sign-up policy is an instance
  setting. Better Auth 1.7.8 (1.7.9+ under the age policy).
