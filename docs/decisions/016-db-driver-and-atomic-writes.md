# 016 — libsql on Node, batch-only atomic writes, build-time driver split

Date: 2026-10-15 · Status: Accepted · Refines 003

## Context
Decision 003 chose SQLite (D1 on Cloudflare, a file elsewhere). Phase 0 had to pick the Node
driver and make both drivers look the same to app code. D1 has no interactive transactions, and a
native Node module must never reach the Worker bundle.

## Decision
- **Node driver: libsql** (`@libsql/client`, `file:` URLs). It is async like D1, supports Drizzle
  `batch()`, and ships prebuilt binaries with no install scripts.
- **One `Db` type** (`packages/db/src/types.ts`): Drizzle's async SQLite database without
  `transaction()`, plus `batch()`. **`batch()` is the only atomic multi-statement write.** Phase 1
  (invite + membership) and Phase 2 (cache upserts) must be written as batches: compute inputs
  first, then write in one batch. No read-modify-write inside a transaction.
- **Build-time driver split:** app code gets the database from `@/server/db`. `next.config.ts`
  aliases it to the D1 or libsql runtime from `GITWORK_TARGET`. `scripts/scan-worker-bundle.sh`
  fails the build check if libsql reaches the Worker bundle.

## Alternatives considered
- **better-sqlite3:** fast and mature, but sync (a second type shape), and it needs a native build
  script.
- **Runtime driver branch** (`if (env.DB) … else …`): the bundler still traces libsql into the
  Worker.
- **Drizzle `transaction()` on Node only:** code that works on Node would break on D1.

## Consequences
- Logic that needs a conditional write uses SQL conditions (`INSERT … ON CONFLICT`, `WHERE`
  guards) inside a batch, or an idempotency key.
- Both drivers run the same contract suite in CI.
