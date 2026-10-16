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

describe.each(drivers)("/api/v1 tasks on $name", (driver: TestDriver) => {
  let database: Database;
  let w: Awaited<ReturnType<typeof setupWorkspace>>;
  let deps: ApiDeps;
  let auth: ReturnType<typeof testAuth>;
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
    // Reads never need GitHub.
    expect((await api("GET", "/tasks", { as: "max" })).status).toBe(200);
  });
});
