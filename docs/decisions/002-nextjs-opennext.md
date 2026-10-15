# 002 — Standard Next.js with the OpenNext adapter, not vinext

Date: 2026-10-15 · Status: Accepted

## Context
Cloudflare's guide now defaults new Next.js projects to vinext. Gitwork must run on Cloudflare and
anywhere else (001). vinext can build a standalone Node server, but its README calls it
experimental and "under active development".

## Decision
Use standard Next.js (App Router). Deploy to Cloudflare Workers with `@opennextjs/cloudflare`. Run
everywhere else with `next start` or the standalone output in Docker.

## Alternatives considered
- **vinext:** native Workers integration and Vite tooling, but experimental. Self-hosters would
  inherit its gaps. Revisit when it is stable.

## Consequences
- Phase 0 must prove the app builds and runs under both `next start` and `wrangler dev`.
- OpenNext limits (bundle size, Node APIs on Workers) apply to every dependency choice.
