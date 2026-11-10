import { type Database, ghIssues, ghProjectItems } from "@gitwork/db";
import { eq } from "drizzle-orm";
import { type TestDriver, allTestDrivers } from "@gitwork/db/testing";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { ApiDeps } from "../src/api/router";
import { handleApiRequest } from "../src/api/routes";
import { APP } from "./github-helpers";
import { BASE_URL, signIn, testAuth } from "./helpers";
import { IDS, setupWorkspace, tokenAuth } from "./tasks-fixture";

const drivers = await allTestDrivers();
afterAll(() => Promise.all(drivers.map((d) => d.dispose())));

describe.each(drivers)("/api/v1 tasks on $name", (driver: TestDriver) => {
  let database: Database;
  let w: Awaited<ReturnType<typeof setupWorkspace>>;
  let deps: ApiDeps;
  let auth: ReturnType<typeof testAuth>;
  const cookies: Record<string, string> = {};

  function api(method: string, path: string, opts: { as?: string; body?: unknown; headers?: Record<string, string> } = {}) {
    const headers = new Headers({ origin: BASE_URL, ...opts.headers });
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
  const link = (as: string, repoNodeIds: string[] = [IDS.site]) =>
    api("PUT", "/github", { as, body: { installationId: 99, projectNodeId: IDS.board, repoNodeIds } });

  beforeEach(async () => {
    database = await driver.fresh();
    w = await setupWorkspace(database);
    auth = testAuth(database);
    // Real sessions; user tokens from the stand-in (Better Auth cannot mint GitHub tokens here).
    const api = { ...auth.auth.api, ...(tokenAuth as { api: object }).api };
    deps = { database, auth: { ...auth.auth, api } as never, email: auth.email, baseURL: BASE_URL, github: { app: APP, client: w.client } };
    for (const user of ["jane", "max", "rita", "sam"]) cookies[user] = await signIn(auth.auth, auth.email, `${user}@example.com`);
  });

  it("returns 401 without a session", async () => {
    expect((await api("GET", "/tasks")).status).toBe(401);
    expect((await api("GET", "/github/candidates")).status).toBe(401);
    expect((await api("PUT", "/github", { body: {} })).status).toBe(401);
    expect((await api("POST", "/tasks", { body: {} })).status).toBe(401);
  });

  it("links (Admin with GitHub), then serves filtered tasks", async () => {
    expect((await link("sam")).status).toBe(403);
    const res = await link("jane");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ repoNodeIds: [IDS.site], firstSync: { synced: 2 } });
    await api("PATCH", "/settings", { as: "jane", body: { hideLabel: "Internal" } });

    const reader = (await (await api("GET", "/tasks", { as: "rita" })).json()) as { tasks: { title: string }[] };
    expect(reader.tasks.map((t) => t.title).sort()).toEqual(["Homepage hero", "Pricing table"]);
    expect((await api("GET", "/tasks/PVTI_site2", { as: "rita" })).status).toBe(404);
    expect((await api("GET", "/tasks/PVTI_site2", { as: "max" })).status).toBe(200);
    const summary = await (await api("GET", "/github", { as: "rita" })).json();
    expect(summary).toMatchObject({ linked: true, repos: [{ fullName: "acme/site" }] });
  });

  it("validates link, task, and settings bodies with 400", async () => {
    expect((await link("jane", [])).status).toBe(400);
    await link("jane");
    expect((await api("POST", "/tasks", { as: "max", body: { repoNodeId: IDS.site, title: "  " } })).status).toBe(400);
    expect(
      (await api("PATCH", "/tasks/PVTI_site1", { as: "max", body: { fields: { [IDS.target]: { type: "date", date: "July 1" } } } })).status,
    ).toBe(400);
    expect((await api("PATCH", "/settings", { as: "jane", body: { hideLabel: "x".repeat(51) } })).status).toBe(400);
    expect((await api("PATCH", "/github/fields", { as: "jane", body: { kanbanFieldId: IDS.start } })).status).toBe(400);
  });

  it("creates and edits tasks; Read Only gets 403", async () => {
    await link("jane");
    const created = await api("POST", "/tasks", { as: "max", body: { repoNodeId: IDS.site, title: "From the API", body: "Hello" } });
    expect(created.status).toBe(200);
    const { task } = (await created.json()) as { task: { id: string; body: string } };
    expect(task.body).toBe("Hello\n\n— Max Member via Gitwork");
    const moved = await api("PATCH", `/tasks/${task.id}`, { as: "max", body: { fields: { [IDS.status]: { type: "single_select", optionId: IDS.done } } } });
    expect(moved.status).toBe(200);
    expect((await api("POST", "/tasks", { as: "rita", body: { repoNodeId: IDS.site, title: "No" } })).status).toBe(403);
    expect((await api("PATCH", "/tasks/PVTI_site1", { as: "rita", body: { title: "No" } })).status).toBe(403);
    expect((await api("PATCH", "/settings", { as: "max", body: { hideLabel: "x" } })).status).toBe(403);
    expect((await api("PATCH", "/github/fields", { as: "max", body: { kanbanFieldId: IDS.status } })).status).toBe(403);
    expect((await api("DELETE", "/github", { as: "max" })).status).toBe(403);
  });

  it("turns a GitHub rate limit into 503 with Retry-After, and a missing App into 409", async () => {
    await link("jane");
    w.fake.failNext = { status: 429, headers: { "retry-after": "30" } };
    const limited = await api("POST", "/tasks", { as: "max", body: { repoNodeId: IDS.site, title: "Later" } });
    expect(limited.status).toBe(503);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    deps = { ...deps, github: null };
    expect((await api("POST", "/tasks", { as: "max", body: { repoNodeId: IDS.site, title: "x" } })).status).toBe(409);
    // A role that may not write learns nothing about the instance's setup.
    expect((await api("POST", "/tasks", { as: "rita", body: { repoNodeId: IDS.site, title: "x" } })).status).toBe(403);
    expect((await api("GET", "/github/candidates", { as: "rita" })).status).toBe(403);
    expect((await api("PUT", "/github", { as: "sam", body: { installationId: 99, projectNodeId: IDS.board, repoNodeIds: [IDS.site] } })).status).toBe(403);
    expect((await api("GET", "/github/candidates", { as: "jane" })).status).toBe(409);
    // Reads never need GitHub.
    expect((await api("GET", "/tasks", { as: "max" })).status).toBe(200);
  });

  // ---- /sync (decision 033) ---------------------------------------------------------------------

  const sync = (as: string, etag?: string) => api("GET", "/sync", { as, headers: etag ? { "if-none-match": etag } : {} });
  const setTitle = (nodeId: string, title: string) => database.db.update(ghIssues).set({ title }).where(eq(ghIssues.nodeId, nodeId));

  it("sync: 401 without a session", async () => {
    expect((await api("GET", "/sync")).status).toBe(401);
  });

  it("sync: serves the filtered snapshot with a private ETag, and 304 when nothing changed", async () => {
    await link("jane");
    await api("PATCH", "/settings", { as: "jane", body: { hideLabel: "Internal" } });
    const res = await sync("rita");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-cache");
    expect(res.headers.get("vary")).toBe("Cookie");
    const etag = res.headers.get("etag")!;
    expect(etag).toMatch(/^"[A-Za-z0-9_-]{43}"$/);
    const body = (await res.json()) as { role: string; canWrite: boolean; board: { tasks: { title: string }[] } };
    expect(body.role).toBe("read_only");
    expect(body.canWrite).toBe(false);
    expect((body as unknown as { viewer: unknown }).viewer).toEqual({ githubLinked: false });
    const jane = (await (await sync("jane")).json()) as { viewer: unknown };
    expect(jane.viewer).toEqual({ githubLinked: true });
    expect(body.board.tasks.map((t) => t.title).sort()).toEqual(["Homepage hero", "Pricing table"]);

    const again = await sync("rita", etag);
    expect(again.status).toBe(304);
    expect(await again.text()).toBe("");
    // The ETag is per viewer: a Member sees more, so the same ETag does not match.
    expect((await sync("max", etag)).status).toBe(200);
  });

  it("sync: a change only to hidden or unlinked items gives Read Only a 304; a visible change gives 200", async () => {
    await link("jane");
    await api("PATCH", "/settings", { as: "jane", body: { hideLabel: "Internal" } });
    const rita0 = (await sync("rita")).headers.get("etag")!;
    const max0 = (await sync("max")).headers.get("etag")!;

    await setTitle("I_acme/site#2", "Internal pricing notes v2"); // hidden by label
    await setTitle("I_acme/internal#1", "Secret roadmap v2"); // repo not linked
    await database.db.update(ghProjectItems).set({ draftTitle: "Idea: light mode" }).where(eq(ghProjectItems.nodeId, "PVTI_draft"));
    expect((await sync("rita", rita0)).status).toBe(304);
    // The same edits are visible to a Member, so the Member's snapshot changes: the check can fail.
    expect((await sync("max", max0)).status).toBe(200);

    await setTitle("I_acme/site#1", "Homepage hero v2"); // visible to everyone
    const changed = await sync("rita", rita0);
    expect(changed.status).toBe(200);
    expect(changed.headers.get("etag")).not.toBe(rita0);
    const body = (await changed.json()) as { board: { tasks: { title: string }[] } };
    expect(body.board.tasks.map((t) => t.title).sort()).toEqual(["Homepage hero v2", "Pricing table"]);
  });

  it("sync: a role change changes the snapshot", async () => {
    await link("jane");
    const before = (await sync("rita")).headers.get("etag")!;
    await api("PATCH", `/members/rita`, { as: "jane", body: { role: "member" } });
    const after = await sync("rita", before);
    expect(after.status).toBe(200);
    expect(((await after.json()) as { role: string; canWrite: boolean }).canWrite).toBe(true);
  });
});
