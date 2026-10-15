# 019 — Instance admins and email come from the environment; the wizard creates the GitHub App

Date: 2026-10-15 · Status: Accepted · Supersedes part of 001

## Context
Decision 001 said a first-run wizard collects the admin email and SMTP settings. Two problems:
nobody can sign in before email works, and an open first-run wizard is taken over by whoever visits
first.

## Decision
- **Instance admins** are the emails in `INSTANCE_ADMIN_EMAILS`. Signing in with one proves the
  admin; there is no setup token and no "first visitor wins". Admins may always sign up and create
  Accounts, even on an invite-only instance.
- **Email** is configured with environment variables (`EMAIL_TRANSPORT`, `SMTP_URL`, or the
  Cloudflare `send_email` binding) before first run.
- **The wizard (`/setup`)** is admin-only. It creates the GitHub App with GitHub's manifest flow
  and sets the sign-up policy.
- **GitHub App credentials** come from environment variables when all five are set (`GITHUB_APP_ID`,
  `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`; the
  hosted version), otherwise from the `github_app` row the wizard writes, sealed with AES-GCM under a
  key derived from `BETTER_AUTH_SECRET`.

## Alternatives considered
- **Setup token printed to the log:** awkward on Workers, where logs are not at hand.
- **First signed-in user becomes admin:** a race on a public URL.

## Consequences
- Rotating `BETTER_AUTH_SECRET` makes the stored App credentials (and linked GitHub tokens)
  unreadable. The app then reports "re-run setup".
- The wizard never overwrites an existing App; replacing one is a manual step (delete the row).
