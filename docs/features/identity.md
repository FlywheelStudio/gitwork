# Identity — sign-in, accounts, workspaces, roles, invites

Shipped 2026-10-15 (Phase 1). Branch `feature/identity`. Decisions 005, 006, 007, 016, 017.

## What it does
- People sign in with a 6-digit email code. The same email carries a link that signs them in on
  click.
- A signed-in user creates an **Account** and its first **workspace**. Account Owners add more
  workspaces.
- Owners and Admins invite people by email with a role. The invitee signs in as that email and
  accepts.
- Owners and Admins change roles and remove members within the role matrix. Anyone can leave.
- Users link a GitHub account in Settings (needed only for GitHub tasks, decision 017).

## How it works

**Packages.**
- `packages/core/src/permissions.ts` — the role matrix as data: `authorize()`, `can()`,
  `effectiveRole()`, `invitableRoles()`, `canManageMember()`, `GITHUB_CAPABILITIES`.
- `packages/server` — everything that touches the database or Better Auth:
  - `auth.ts` — `createAuth()`. Better Auth owns identity only: `users`, `sessions`,
    `auth_identities` (its "account" model, renamed), `verifications`, `rate_limits`.
  - `services/` — `access`, `accounts`, `members`, `invites`. Each takes a `Db` and a
    `WorkspaceAccess`, checks `packages/core`, and throws `ServiceError` (status + code).
  - `api/` — a framework-free `/api/v1` router (`handleApiRequest(request, deps)`).
  - `email.ts` / `email-node.ts` — adapters: console (dev), outbox (tests), SMTP (Node),
    Cloudflare Email Service (Workers). Production with none configured fails closed.
- `apps/web` — pages, `app/api/auth/[...all]` (Better Auth), `app/api/v1/[...path]` (the router),
  and `src/server/context.ts` (`getDeps()`, `getSession()`, built per request).

**Sign-in.** Better Auth `emailOTP`: 6 digits, 10-minute expiry, 5 attempts, stored hashed. The
email link is `/sign-in/verify#email=…&code=…`: the code is in the fragment (never sent to the
server) and the page POSTs only on a click, because email link scanners load links. Rate limits
live in `rate_limits` (5 code requests per 5 minutes per IP), since Worker isolates share no
memory. Client IP comes from `cf-connecting-ip` or `x-forwarded-for`.

**Sign-up policy.** `instance_settings.signups` = `open` (default) or `invite-only`. A
`user.create.before` hook allows a new user when sign-ups are open or a valid invite exists for the
email. Under `invite-only`, only the first Account on the instance or an existing Account Owner can
create an Account.

**GitHub link.** Better Auth's GitHub provider with the GitHub App's OAuth credentials
(`GITHUB_CLIENT_ID`/`SECRET` until Phase 2). `disableSignUp: true` (link only),
`allowDifferentEmails`, tokens encrypted at rest, unique `(provider_id, account_id)`.

## Data model

| Table | Purpose |
|---|---|
| `accounts` | A person or agency. |
| `account_owners` | (account, user). Owner in every workspace of the account. |
| `workspaces` | One project. `read_only_can_comment`, `show_drafts_to_read_only` (both off). |
| `workspace_members` | (workspace, user, role). CHECK on role. |
| `invites` | email (CHECK lowercase), role (CHECK), `token_hash` (SHA-256), `expires_at` (7 days), `accepted_at/by`, `revoked_at`. |

Access is checked in code on every request (no row-level security in SQLite). No access and no
workspace both return 404.

**Atomic writes (decision 016).** Account + owner + workspace is one `batch()`. Invite acceptance
is one batch whose membership `INSERT … SELECT … FROM invites WHERE <pending, email, token>` carries
the guard, with the role taken from the invite row. Role changes and removals update only
`WHERE role = <the role we checked>`; a concurrent change returns 409.

## API (`/api/v1`)

| Method | Path | Notes |
|---|---|---|
| GET | `/me` | User + workspaces with roles. |
| POST | `/accounts` | `{accountName, workspaceName}`. |
| POST | `/accounts/:accountId/workspaces` | Account Owners only. |
| GET | `/workspaces/:id` | Role, `hasGitHub`, allowed capabilities. |
| GET | `/workspaces/:id/members` | Members + Account Owners. |
| PATCH/DELETE | `/workspaces/:id/members/:userId` | Role change / remove or leave. |
| GET/POST | `/workspaces/:id/invites` | List / create (sends the email). |
| DELETE | `/workspaces/:id/invites/:inviteId` | Revoke. |
| GET | `/invites/:token` | Preview. No auth. |
| POST | `/invites/:token/accept` | |

Cookie-authenticated writes must be same-origin (`Sec-Fetch-Site` or `Origin`). Bearer tokens
(Better Auth `bearer` plugin, for the Mac app) are exempt.

## Testing
- `packages/core` — 78 tests: every role × capability against a hand-written copy of the matrix.
- `packages/server` — on libsql **and** D1: sign-in through the HTTP handler (code email, fragment
  link, hashed storage, wrong code, rate limit, invite-only sign-up), services (accounts, access,
  invites incl. expired/revoked/wrong-email with no membership row, members), API (401, 403, 400,
  404/405, cross-site 403, bearer), GitHub link start.
- E2E (Playwright, Node): owner creates a workspace and invites a client, who signs in and accepts
  as Read Only; the email link signs in only after a click.
- `pnpm smoke`: a full email-code sign-in inside the Worker bundle (D1 + local `send_email`).
- Weakening checks proven red: flipping one matrix cell; memory rate limits or plain codes;
  removing the invite guard.

## Gotchas
- **Never verify a sign-in code on GET.** Link scanners would use it up. Covered by the E2E link
  test (loading the page leaves no session).
- **Guards go inside the statement, not beside it in the batch.** A batch rolls back on errors,
  not on zero-row updates. Covered by the expired/revoked invite tests.
- **Pages must read the request before config.** `getSession()` calls `headers()` first; the
  invite page calls `connection()`. Otherwise `next build` prerenders the page and throws on the
  missing `BETTER_AUTH_SECRET`. Covered by `pnpm smoke` (builds without a secret).
- **wrangler types narrow `process.env`** to the Worker's vars. Read Node env through a plain
  `Record<string, string | undefined>`.
- **Local `send_email` writes the message file just after the response.** The smoke script polls
  for it.
- **The GitHub OAuth callback is untested** until Phase 2 creates a real GitHub App.
- UI is plain Tailwind for now; shadcn/ui comes with the Phase 3 task views.
