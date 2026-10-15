# 014 — Notifications without email in v1

Date: 2026-10-15 · Status: Accepted

## Context
GitHub already notifies GitHub users. Push services add setup for self-hosters.

## Decision
- In-app inbox: mentions, assignments, status changes on your tasks, replies to your comments.
- Mac app: native macOS notifications, pulled from the API. No APNs, no Pushfire.
- No email notifications in v1. Email is used only for sign-in (005).

## Consequences
- The workspace standard says Pushfire for push. Gitwork sends no remote push, so the standard does
  not apply.
