# 024 — AGPL-3.0-only confirmed; contributions under a DCO

Date: 2026-11-10 · Status: Accepted (owner) · Confirms 001

## Context
Decision 001 chose AGPL-3.0 with the SPDX id `AGPL-3.0-only` pending owner confirmation, and left
the contribution terms open.

## Decision
- The license is `AGPL-3.0-only`.
- Contributors sign off each commit under the Developer Certificate of Origin (DCO). No contributor
  license agreement (CLA).

## Alternatives considered
- **CLA:** lets Flywheel relicense outside contributions or sell closed add-ons. Adds friction for
  contributors and is not needed while the hosted version runs the open code.

## Consequences
- Flywheel cannot later sell closed add-ons that include outside contributions.
- CI checks for `Signed-off-by` on pull-request commits.
