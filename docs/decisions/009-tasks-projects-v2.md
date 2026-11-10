# 009 — Tasks from Projects v2; Admin maps fields to views

Date: 2026-10-15 · Status: Accepted

## Context
GitHub now has issue-native dates (org issue fields), sub-issues, and dependencies. The owner chose
Projects v2 as the task source.

## Decision
- Tasks come from the workspace's Projects v2 board (006).
- Views: list (sub-issues nested), kanban, timeline (Gantt, dependency arrows).
- The app auto-detects defaults: kanban groups by `Status`; timeline uses "Start date" and "Target
  date", or an iteration field. Admins override per workspace. Users can switch kanban grouping to
  any single-select field.
- A new task is always a real issue in a repo the user picks (default: last used), then added to the
  board. No draft items from the app.

## Alternatives considered
- **Issue-native fields only, no board:** avoids preview webhooks, but the owner chose Projects v2.

## Consequences
- Requires the org Projects permission, so org-owned boards only (006).
- Projects v2 webhooks are in public preview; reconcile covers gaps (010).
- Field mapping has "Auto-detect" (by GitHub's usual field names) but no "none": a mapped field can
  be overridden, not switched off. (Owner confirmed 2026-10-16.)
