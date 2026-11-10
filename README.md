# Gitwork

Project management on top of GitHub. GitHub stays the source of truth for tasks and docs. Gitwork
gives your team, clients, and stakeholders a fast, permissioned view of it: list, kanban, and
timeline views of a GitHub Projects v2 board, with edits that go back to GitHub.

People without a GitHub account can take part. Four roles (Owner, Admin, Member, Read Only) decide
what each person sees and changes. Read Only users never receive hidden items.

> **Status: pre-release.** Tasks work end to end against a simulated GitHub. Docs editing, the
> activity inbox, and the Mac app are still in progress. See [docs/STATE.md](docs/STATE.md) and the
> [roadmap](docs/roadmap.md).

## Self-host

Gitwork is open source under the [AGPL-3.0](LICENSE). Run it on any Docker host or on Cloudflare
Workers.

```bash
git clone https://github.com/FlywheelStudio/gitwork && cd gitwork
cp .env.example .env        # fill in the URL, secret, admin email, and SMTP
docker compose up -d
```

The full guide, with Cloudflare, backups, and upgrades: [docs/self-host/](docs/self-host/README.md).

## Develop

Requires Node 22+ and corepack.

```bash
corepack enable
pnpm install
pnpm dev                 # Node + SQLite file at apps/web/.data/ → http://localhost:3000
pnpm preview             # Cloudflare Workers (workerd) + local D1 → http://localhost:8787
```

Checks, as CI runs them:

```bash
pnpm lint && pnpm typecheck
pnpm test                # unit and integration; the DB suite runs on both libsql and D1
pnpm test:e2e            # Playwright against the Node runtime
pnpm smoke               # builds and serves both runtimes end to end
```

Read [CONTRIBUTING.md](CONTRIBUTING.md) before a pull request. Every commit needs a DCO sign-off
(`git commit -s`).

## Docs

Start at [docs/INDEX.md](docs/INDEX.md). The product spec is [docs/spec.md](docs/spec.md).

## Security

Report vulnerabilities privately. See [SECURITY.md](SECURITY.md).

## License

[AGPL-3.0-only](LICENSE). If you run a modified Gitwork for other people, you must offer them your
source code.
