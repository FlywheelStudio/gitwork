# 022 — Cloudflare hosting requires the Workers Paid plan

Date: 2026-10-16 · Status: Accepted (owner) · Builds on 001, 002

## Context
The Worker bundle is 3.40 MiB gzipped after Phase 3 (3.23 MiB after Phase 2). The Workers Free
plan allows 3 MiB per Worker; the Paid plan allows 10 MiB. Free also caps subrequests at 50 per
invocation, which the reconcile defaults already exceed.

## Decision
Deploying Gitwork to Cloudflare requires the Workers Paid plan. We do not cut the bundle to fit
the Free plan. Node hosts (decision 001) have no such limit.

## Alternatives considered
- **Cut the bundle under 3 MiB:** drop or lazy-load dependencies (Better Auth plugins, Radix,
  drizzle). Costly, and every phase adds code; the limit would bind again soon.
- **Support Free with reduced features:** two configurations to test for a small saving.

## Consequences
- The self-host guide (Phase 7) and the Deploy-to-Cloudflare button state the Paid plan.
- `pnpm smoke` should fail when the gzipped bundle passes 10 MiB (follow-up).
- Reconcile defaults (`RECONCILE_MAX_PAGES`) stay sized for the Paid plan.
