# 015 — pnpm monorepo, versioned REST API, working name

Date: 2026-10-15 · Status: Accepted

## Decision
- One repo, pnpm workspaces: `apps/web`, `apps/mac`, `packages/core`, `packages/db`.
- The web app exposes a versioned REST API at `/api/v1`, described by an OpenAPI spec. The Mac app
  uses only this API. It is the public extension point; personal API tokens come later.
- "Gitwork" is the working name, kept in one config constant so a rename costs one commit.
