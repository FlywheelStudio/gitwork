# 012 — Hidden items for Read Only users

Date: 2026-10-15 · Status: Accepted

## Context
One repo often holds client-safe and internal content side by side.

## Decision
- Each workspace can set a hide label (issues) and a hide folder (docs). Read Only users never see
  items that match.
- Default: nothing hidden. The label and folder are empty until an Admin sets them.
- Exception: draft items are hidden from Read Only by default, because they carry no labels.
  The workspace setting "Show draft items to Read Only" turns them on (006).
- The server filters every response, including the API the Mac app uses and image proxying.

## Consequences
- Filtering lives in `packages/core` with tests for both allowed and denied paths.
