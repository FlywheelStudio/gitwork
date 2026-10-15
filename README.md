# Gitwork

Project management on top of GitHub. GitHub stays the source of truth for tasks and docs; Gitwork
gives your clients and stakeholders a fast, permissioned view of it — list, kanban, and timeline
views of a GitHub Projects v2 board, plus editable markdown from each repo's `docs/` folder.

> **Status:** early development (Phase 0 of 7). Not usable yet. See [docs/STATE.md](docs/STATE.md).

## Run it locally

Requires Node 22+ and corepack (ships with Node 22–24).

```bash
corepack enable          # provides the pinned pnpm
pnpm install
pnpm dev                 # Node + SQLite file at apps/web/.data/ → http://localhost:3000
pnpm preview             # Cloudflare Workers (workerd) + local D1 → http://localhost:8787
```

## Checks

```bash
pnpm lint && pnpm typecheck
pnpm test                # unit tests; the DB suite runs on both libsql and D1
pnpm test:e2e            # Playwright against the Node runtime
pnpm smoke               # builds and serves both runtimes end to end
```

## Self-hosting

Gitwork runs on Cloudflare Workers (D1) or any Node host (SQLite file). Deploy guides arrive in
Phase 7. For Cloudflare today: `wrangler d1 create gitwork`, put the ID in
`apps/web/wrangler.jsonc`, then `wrangler d1 migrations apply DB --remote` and
`pnpm --filter @gitwork/web exec opennextjs-cloudflare deploy`.

## Docs

Start at [docs/INDEX.md](docs/INDEX.md). The product spec is [docs/spec.md](docs/spec.md).

## License

[AGPL-3.0](LICENSE).
