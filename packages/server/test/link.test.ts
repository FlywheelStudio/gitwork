import { type Database, auditLog, ghIssues, ghProjectItems, ghSyncTargets, workspaceGithub, workspaceRepos } from "@gitwork/db";
import { type TestDriver, allTestDrivers } from "@gitwork/db/testing";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ServiceError } from "../src/errors";
import { linkWorkspace, listLinkCandidates, unlinkWorkspace } from "../src/services/link";
import { IDS, setupWorkspace } from "./tasks-fixture";

const drivers = await allTestDrivers();
afterAll(() => Promise.all(drivers.map((d) => d.dispose())));

async function rejects(promise: Promise<unknown>, status: number, code?: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ServiceError);
  expect((error as ServiceError).status).toBe(status);
  if (code) expect((error as ServiceError).code).toBe(code);
}

describe.each(drivers)("workspace link on $name", (driver: TestDriver) => {
  let database: Database;
  let w: Awaited<ReturnType<typeof setupWorkspace>>;

  beforeEach(async () => {
    database = await driver.fresh();
    w = await setupWorkspace(database);
  });

  const nothingLinked = async () => {
    expect(await w.db.select().from(workspaceGithub)).toHaveLength(0);
    expect(await w.db.select().from(workspaceRepos)).toHaveLength(0);
    expect(await w.db.select().from(ghSyncTargets)).toHaveLength(0);
  };

  it("offers only what the user's own GitHub account can see", async () => {
    const { installations } = await listLinkCandidates(w.deps, await w.access("jane"));
    expect(installations.map((i) => i.login)).toEqual(["acme"]);
    expect(installations[0]!.repos.map((r) => r.fullName).sort()).toEqual(["acme/internal", "acme/site"]);
    expect(installations[0]!.projects.map((p) => p.nodeId)).toEqual([IDS.board]);
  });

  it("links a board and repos, adds sync targets, and runs a first sync", async () => {
    const out = await linkWorkspace(w.deps, await w.access("jane"), { installationId: 99, projectNodeId: IDS.board, repoNodeIds: [IDS.site] });
    expect(out.firstSync.synced.sort()).toEqual(["project:acme#1", "repo:acme/site"]);
    expect((await w.db.select().from(workspaceRepos)).map((r) => r.repoNodeId)).toEqual([IDS.site]);
    const targets = await w.db.select().from(ghSyncTargets);
    expect(targets.map((t) => `${t.kind}:${t.locator}`).sort()).toEqual(["project:acme#1", "repo:acme/site"]);
    expect((await w.db.select().from(ghIssues)).length).toBeGreaterThan(0);
    expect((await w.db.select().from(ghProjectItems)).length).toBe(7);
    const [audit] = await w.db.select().from(auditLog);
    expect(audit).toMatchObject({ action: "workspace.link", userId: "jane", via: "user" });
  });

  it("refuses a repo the App can reach but the user cannot", async () => {
    await rejects(
      linkWorkspace(w.deps, await w.access("jane"), { installationId: 99, projectNodeId: IDS.board, repoNodeIds: [IDS.site, IDS.secret] }),
      403,
      "github_no_access",
    );
    await nothingLinked();
  });

  it("refuses an installation the user cannot see", async () => {
    await rejects(
      linkWorkspace(w.deps, await w.access("jane"), { installationId: 100, projectNodeId: IDS.globexBoard, repoNodeIds: [IDS.globexApp] }),
      403,
      "github_no_access",
    );
    await nothingLinked();
  });

  it("refuses a board from another org, even one the user can see", async () => {
    await rejects(
      linkWorkspace(w.deps, await w.access("jane"), { installationId: 99, projectNodeId: IDS.globexBoard, repoNodeIds: [IDS.site] }),
      403,
      "github_no_access",
    );
    await nothingLinked();
  });

  it("refuses repos from another installation than the one picked", async () => {
    w.fake.users.get("ghu_jane")!.repos.add("globex/app");
    await rejects(
      linkWorkspace(w.deps, await w.access("jane"), { installationId: 99, projectNodeId: IDS.board, repoNodeIds: [IDS.globexApp] }),
      403,
    );
    await nothingLinked();
  });

  it("needs a linked GitHub account, and an Owner or Admin role", async () => {
    await rejects(
      linkWorkspace(w.deps, await w.access("owner"), { installationId: 99, projectNodeId: IDS.board, repoNodeIds: [IDS.site] }),
      403,
      "github_link_required",
    );
    await rejects(
      linkWorkspace(w.deps, await w.access("sam"), { installationId: 99, projectNodeId: IDS.board, repoNodeIds: [IDS.site] }),
      403,
      "forbidden",
    );
    await rejects(listLinkCandidates(w.deps, await w.access("rita")), 403);
    await nothingLinked();
  });

  it("asks to re-link when the stored GitHub token no longer works", async () => {
    const broken = { ...w.deps, auth: { api: { getAccessToken: async () => Promise.reject(new Error("revoked")), refreshToken: async () => ({}) } } as never };
    await rejects(listLinkCandidates(broken, await w.access("jane")), 409, "github_relink");
  });

  it("prunes sync targets no workspace uses, on relink and unlink", async () => {
    const jane = await w.access("jane");
    await linkWorkspace(w.deps, jane, { installationId: 99, projectNodeId: IDS.board, repoNodeIds: [IDS.site, IDS.internal] });
    await linkWorkspace(w.deps, jane, { installationId: 99, projectNodeId: IDS.board, repoNodeIds: [IDS.site] });
    expect((await w.db.select().from(ghSyncTargets)).map((t) => t.locator).sort()).toEqual(["acme#1", "acme/site"]);
    await unlinkWorkspace(w.db, jane);
    await nothingLinked();
  });

  it("resets the field mapping when the board changes, not when only repos change", async () => {
    const jane = await w.access("jane");
    await linkWorkspace(w.deps, jane, { installationId: 99, projectNodeId: IDS.board, repoNodeIds: [IDS.site] });
    await w.db.update(workspaceGithub).set({ kanbanFieldId: IDS.status });
    await linkWorkspace(w.deps, jane, { installationId: 99, projectNodeId: IDS.board, repoNodeIds: [IDS.site, IDS.internal] });
    expect((await w.db.select().from(workspaceGithub))[0]?.kanbanFieldId).toBe(IDS.status);
  });
});
