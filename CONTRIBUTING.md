# Contributing to Gitwork

Thank you for helping. This file covers how to set up, what a pull request needs, and the rules that
keep Gitwork safe.

## Set up

```bash
corepack enable
pnpm install
pnpm dev
```

`CLAUDE.md` lists every command and the codebase map. `docs/INDEX.md` lists every design decision.

## Sign off every commit (DCO)

Gitwork accepts contributions under the [Developer Certificate of Origin](https://developercertificate.org/)
(decision 024). Sign off each commit to certify that you wrote it or may submit it under the
project's license:

```bash
git commit -s -m "fix: …"
```

This adds `Signed-off-by: Your Name <you@example.com>`, matching the commit author. A CI check
fails a pull request with an unsigned commit. To fix one: `git rebase --signoff origin/main`, then
push.

## A pull request needs

- `pnpm lint && pnpm typecheck && pnpm test` passing. CI also runs `pnpm test:e2e`, `pnpm smoke`,
  and a Docker self-host check.
- Tests for the change. API routes: success, 401, 403, 400. Database code runs on both drivers
  (`describe.each(await allTestDrivers())`).
- Docs in the same pull request: a decision record in `docs/decisions/` for a decision of lasting
  consequence, and `docs/INDEX.md` updated.
- Commit messages as `<type>: <what and why>` (feat, fix, docs, test, refactor, chore).

## Rules that must not break

- Every read and write goes through the permission and visibility checks in `packages/core`.
- Read Only users never receive a hidden item, by any path.
- Every write adds an `audit_log` row in the same batch.
- The markdown editors leave untouched lines byte-identical.
- Never call real GitHub from tests. Use `packages/server/test/fake-github.ts`.

## Licensing

By contributing, you license your work under [AGPL-3.0-only](LICENSE).
