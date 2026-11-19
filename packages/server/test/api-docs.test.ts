import type { Database } from "@gitwork/db";
import { type TestDriver, allTestDrivers } from "@gitwork/db/testing";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { ApiDeps } from "../src/api/router";
import { handleApiRequest } from "../src/api/routes";
import { APP } from "./github-helpers";
import { BASE_URL, signIn, testAuth } from "./helpers";
import { IDS, setupWorkspace, tokenAuth } from "./tasks-fixture";

const drivers = await allTestDrivers();
afterAll(() => Promise.all(drivers.map((d) => d.dispose())));

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

describe.each(drivers)("/api/v1 docs on $name", (driver: TestDriver) => {
  let database: Database;
  let w: Awaited<ReturnType<typeof setupWorkspace>>;
  let deps: ApiDeps;
  const cookies: Record<string, string> = {};

  function api(method: string, path: string, opts: { as?: string; body?: unknown } = {}) {
    const headers = new Headers({ origin: BASE_URL });
    if (opts.as) headers.set("cookie", cookies[opts.as]!);
    if (opts.body !== undefined) headers.set("content-type", "application/json");
    return handleApiRequest(
      new Request(`${BASE_URL}/api/v1/workspaces/${w.ws.workspaceId}${path}`, {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      }),
      deps,
    );
  }
  const q = (path: string, extra = "") => `?repo=${IDS.site}&path=${encodeURIComponent(path)}${extra}`;
  const open = async (as: string, path: string) => ((await (await api("GET", `/docs/file${q(path)}`, { as })).json()) as { doc: { sha: string; text: string } }).doc;

  beforeEach(async () => {
    database = await driver.fresh();
    w = await setupWorkspace(database);
    w.fake.commit("acme/site", "main", { "docs/README.md": "# Docs\n", "docs/internal/plan.md": "# Plan\n", "docs/logo.png": new Uint8Array(PNG) });
    const auth = testAuth(database);
    const api2 = { ...auth.auth.api, ...(tokenAuth as { api: object }).api };
    deps = { database, auth: { ...auth.auth, api: api2 } as never, email: auth.email, baseURL: BASE_URL, github: { app: APP, client: w.client } };
    for (const user of ["jane", "max", "rita"]) cookies[user] = await signIn(auth.auth, auth.email, `${user}@example.com`);
    expect((await api("PUT", "/github", { as: "jane", body: { installationId: 99, projectNodeId: IDS.board, repoNodeIds: [IDS.site] } })).status).toBe(200);
    expect((await api("PATCH", "/settings", { as: "jane", body: { hideFolder: "internal" } })).status).toBe(204);
  });

  it("returns 401 without a session", async () => {
    expect((await api("GET", "/docs")).status).toBe(401);
    expect((await api("GET", `/docs/file${q("docs/README.md")}`)).status).toBe(401);
    expect((await api("PUT", "/docs/file", { body: {} })).status).toBe(401);
    expect((await api("GET", `/docs/raw${q("docs/logo.png")}`)).status).toBe(401);
  });

  it("lists and opens docs, filtered for Read Only", async () => {
    const list = (await (await api("GET", "/docs", { as: "rita" })).json()) as { repos: { files: { path: string }[] }[] };
    expect(list.repos[0]!.files.map((f) => f.path)).toEqual(["docs/logo.png", "docs/README.md"]);
    expect((await open("rita", "docs/README.md")).text).toBe("# Docs\n");
    expect((await api("GET", `/docs/file${q("docs/internal/plan.md")}`, { as: "rita" })).status).toBe(404);
    expect((await api("GET", `/docs/file${q("docs/internal/plan.md")}`, { as: "max" })).status).toBe(200);
    const raw = await api("GET", `/docs/raw${q("docs/logo.png")}`, { as: "rita" });
    expect(raw.status).toBe(200);
    expect(raw.headers.get("content-type")).toBe("image/png");
  });

  it("saves, creates, renames, and deletes; Read Only gets 403", async () => {
    const d = await open("max", "docs/README.md");
    const save = await api("PUT", "/docs/file", { as: "max", body: { repoNodeId: IDS.site, path: "docs/README.md", baseSha: d.sha, text: "# Docs\n\nMore.\n" } });
    expect(save.status).toBe(200);
    expect(await save.json()).toMatchObject({ status: "committed" });
    expect((await api("PUT", "/docs/file", { as: "rita", body: { repoNodeId: IDS.site, path: "docs/README.md", baseSha: d.sha, text: "x" } })).status).toBe(403);

    expect((await api("POST", "/docs/file", { as: "max", body: { repoNodeId: IDS.site, path: "docs/new.md" } })).status).toBe(200);
    expect((await api("POST", "/docs/file", { as: "rita", body: { repoNodeId: IDS.site, path: "docs/x.md" } })).status).toBe(403);

    const n = await open("max", "docs/new.md");
    expect((await api("POST", "/docs/rename", { as: "max", body: { repoNodeId: IDS.site, path: "docs/new.md", baseSha: n.sha, newPath: "docs/renamed.md" } })).status).toBe(200);

    const r = await open("max", "docs/renamed.md");
    expect((await api("DELETE", `/docs/file${q("docs/renamed.md", `&sha=${r.sha}`)}`, { as: "max" })).status).toBe(403);
    expect((await api("DELETE", `/docs/file${q("docs/renamed.md", `&sha=${r.sha}`)}`, { as: "jane" })).status).toBe(200);
  });

  it("answers a conflict with 409 and the current text", async () => {
    const d = await open("max", "docs/README.md");
    w.fake.commit("acme/site", "main", { "docs/README.md": "# Theirs\n" });
    const res = await api("PUT", "/docs/file", { as: "max", body: { repoNodeId: IDS.site, path: "docs/README.md", baseSha: d.sha, text: "# Mine\n" } });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "doc_conflict", current: { text: "# Theirs\n" } } });
  });

  it("validates bodies and queries with 400", async () => {
    const d = await open("max", "docs/README.md");
    expect((await api("PUT", "/docs/file", { as: "max", body: { repoNodeId: IDS.site, path: "docs/README.md", baseSha: "nope", text: "x" } })).status).toBe(400);
    expect((await api("PUT", "/docs/file", { as: "max", body: { repoNodeId: IDS.site, path: "docs/README.md", baseSha: d.sha, text: "x".repeat(1_000_001) } })).status).toBe(400);
    expect((await api("GET", "/docs/file?repo=", { as: "max" })).status).toBe(400);
    expect((await api("DELETE", `/docs/file${q("docs/README.md", "&sha=zz")}`, { as: "jane" })).status).toBe(400);
    expect((await api("PATCH", "/settings", { as: "jane", body: { hideFolder: "../up" } })).status).toBe(400);
    expect((await api("PATCH", `/github/repos/${IDS.site}/docs`, { as: "jane", body: { docsPath: "../x" } })).status).toBe(400);
  });

  it("changes a repo's docs folder (Admins) and reports it in the GitHub summary", async () => {
    expect((await api("PATCH", `/github/repos/${IDS.site}/docs`, { as: "max", body: { docsPath: "handbook" } })).status).toBe(403);
    expect((await api("PATCH", `/github/repos/${IDS.site}/docs`, { as: "jane", body: { docsPath: "handbook", docsBranch: "main" } })).status).toBe(204);
    const summary = await (await api("GET", "/github", { as: "max" })).json();
    expect(summary).toMatchObject({ repos: [{ fullName: "acme/site", docs: { path: "handbook", branch: "main", defaultBranch: false } }] });
  });

  it("takes presence heartbeats from writers only", async () => {
    expect((await api("POST", "/docs/presence", { as: "max", body: { repoNodeId: IDS.site, path: "docs/README.md" } })).status).toBe(200);
    const res = await api("POST", "/docs/presence", { as: "jane", body: { repoNodeId: IDS.site, path: "docs/README.md" } });
    expect(await res.json()).toEqual({ editors: [{ userId: expect.any(String), name: "Max Member" }] });
    expect((await api("POST", "/docs/presence", { as: "rita", body: { repoNodeId: IDS.site, path: "docs/README.md" } })).status).toBe(403);
    expect((await api("DELETE", `/docs/presence${q("docs/README.md")}`, { as: "max" })).status).toBe(204);
  });
});
