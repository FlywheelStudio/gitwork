import { type Database, auditLog, ghIssues, workspaces } from "@gitwork/db";
import { type TestDriver, allTestDrivers } from "@gitwork/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ServiceError } from "../src/errors";
import { linkWorkspace } from "../src/services/link";
import { type TaskView, createTask, getTask, listTasks, resolveMapping, setFieldMapping, updateTask } from "../src/services/tasks";
import { updateWorkspaceSettings } from "../src/services/workspace-settings";
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

const titles = (tasks: TaskView[]) => tasks.map((t) => t.title).sort();

describe.each(drivers)("tasks on $name", (driver: TestDriver) => {
  let database: Database;
  let w: Awaited<ReturnType<typeof setupWorkspace>>;
  const writer = (displayName: string) => ({ ...w.deps, displayName });

  async function board(userId: string) {
    const view = await listTasks(w.db, await w.access(userId));
    if (!view.linked) throw new Error("not linked");
    return view;
  }

  beforeEach(async () => {
    database = await driver.fresh();
    w = await setupWorkspace(database);
    // Only acme/site stays linked; acme/internal is on the same board but not in this workspace.
    // Link both first: webhooks cache issues of every installed repo, so the unlinked repo's
    // issues ARE in the cache, and only the filter keeps them out.
    const jane = await w.access("jane");
    await linkWorkspace(w.deps, jane, { installationId: 99, projectNodeId: IDS.board, repoNodeIds: [IDS.site, IDS.internal] });
    await linkWorkspace(w.deps, jane, { installationId: 99, projectNodeId: IDS.board, repoNodeIds: [IDS.site] });
    await updateWorkspaceSettings(w.db, await w.access("owner"), { hideLabel: "internal" });
    w.fake.writes = [];
  });

  describe("reads", () => {
    it("shows Members every task from linked repos, hidden-label ones and drafts included", async () => {
      expect(titles((await board("max")).tasks)).toEqual(["Homepage hero", "Idea: dark mode", "Internal pricing notes", "Pricing table"]);
    });

    it("never shows anyone a task from an unlinked repo, a pull request, or an archived item", async () => {
      expect((await w.db.select().from(ghIssues)).some((i) => i.title === "Secret roadmap")).toBe(true);
      for (const user of ["owner", "jane", "max", "rita"]) {
        const ids = (await board(user)).tasks.map((t) => t.id);
        expect(ids).not.toContain("PVTI_int1");
        expect(ids).not.toContain("PVTI_pr");
        expect(ids).not.toContain("PVTI_old");
      }
    });

    it("hides the hide label and drafts from Read Only", async () => {
      expect(titles((await board("rita")).tasks)).toEqual(["Homepage hero", "Pricing table"]);
      await updateWorkspaceSettings(w.db, await w.access("owner"), { showDraftsToReadOnly: true });
      expect(titles((await board("rita")).tasks)).toEqual(["Homepage hero", "Idea: dark mode", "Pricing table"]);
    });

    it("never points a link at a task the viewer cannot see", async () => {
      const forMember = (await board("max")).tasks.find((t) => t.id === "PVTI_site3")!;
      expect(forMember.parentId).toBe("PVTI_site2");
      // Blocked by internal#1 (unlinked repo) and site#1: only site#1 survives.
      expect(forMember.blockedBy).toEqual(["PVTI_site1"]);
      const forReader = (await board("rita")).tasks.find((t) => t.id === "PVTI_site3")!;
      expect(forReader.parentId).toBeNull();
      expect(JSON.stringify(await board("rita"))).not.toMatch(/Internal pricing|Secret roadmap|PVTI_site2|PVTI_int1/);
    });

    it("returns 404 for a single task the viewer may not see", async () => {
      await rejects(getTask(w.db, await w.access("rita"), "PVTI_site2"), 404);
      await rejects(getTask(w.db, await w.access("owner"), "PVTI_int1"), 404);
      await rejects(getTask(w.db, await w.access("owner"), "PVTI_pr"), 404);
      expect((await getTask(w.db, await w.access("rita"), "PVTI_site1")).title).toBe("Homepage hero");
    });

    it("drops a task whose repo the App lost, and everything when the board is gone", async () => {
      await w.db.update(ghIssues).set({ deleted: true }).where(eq(ghIssues.nodeId, "I_acme/site#1"));
      expect((await board("owner")).tasks.map((t) => t.id)).not.toContain("PVTI_site1");
      const { ghProjects } = await import("@gitwork/db");
      await w.db.update(ghProjects).set({ available: false });
      const view = await board("owner");
      expect(view.board.available).toBe(false);
      expect(view.tasks).toEqual([]);
    });

    it("says when a workspace is not linked", async () => {
      const other = await import("../src/services/accounts").then((m) =>
        m.createWorkspace(w.db, { userId: "owner", accountId: w.ws.accountId, name: "Other" }),
      );
      const { requireWorkspaceAccess } = await import("../src/services/access");
      expect(await listTasks(w.db, await requireWorkspaceAccess(w.db, "owner", other.workspaceId))).toEqual({ linked: false });
    });

    it("maps fields by GitHub's usual names, and lets an Admin override", async () => {
      const view = await board("jane");
      expect(view.mapping).toEqual({ kanbanFieldId: IDS.status, startFieldId: IDS.start, targetFieldId: IDS.target, iterationFieldId: null });
      expect((await setFieldMapping(w.db, await w.access("jane"), { startFieldId: IDS.target, targetFieldId: null })).targetFieldId).toBe(IDS.target);
      await rejects(setFieldMapping(w.db, await w.access("jane"), { kanbanFieldId: IDS.start }), 400);
      await rejects(setFieldMapping(w.db, await w.access("max"), { kanbanFieldId: IDS.status }), 403);
      expect(resolveMapping([], null)).toEqual({ kanbanFieldId: null, startFieldId: null, targetFieldId: null, iterationFieldId: null });
    });
  });

  describe("writes", () => {
    it("creates a real issue as the linked user, adds it to the board, and sets Status", async () => {
      const task = await createTask(writer("Jane Admin"), await w.access("jane"), {
        repoNodeId: IDS.site,
        title: "New footer",
        body: "Links and copyright.",
        fields: { [IDS.status]: { type: "single_select", optionId: IDS.doing } },
      });
      expect(task).toMatchObject({ title: "New footer", body: "Links and copyright.", repo: { fullName: "acme/site" } });
      expect(task.fields[IDS.status]).toMatchObject({ name: "Doing" });
      expect(w.fake.writes).toEqual(["user:jane POST /repos/acme/site/issues", "user:jane addProjectV2ItemById", "user:jane updateProjectV2ItemFieldValue"]);
      const [audit] = await w.db.select().from(auditLog).where(eq(auditLog.action, "task.create"));
      expect(audit).toMatchObject({ userId: "jane", via: "user", repoNodeId: IDS.site });
      expect((await board("jane")).lastRepoNodeId).toBe(IDS.site);
      expect((await board("max")).lastRepoNodeId).toBeNull();
    });

    it("writes through the App, with attribution, for a Member without GitHub", async () => {
      const task = await createTask(writer("Max Member"), await w.access("max"), { repoNodeId: IDS.site, title: "Typo on pricing", body: "Fix it." });
      expect(task.body).toBe("Fix it.\n\n— Max Member via Gitwork");
      expect(w.fake.writes).toEqual(["app POST /repos/acme/site/issues", "app addProjectV2ItemById"]);
      const [audit] = await w.db.select().from(auditLog).where(eq(auditLog.action, "task.create"));
      expect(audit).toMatchObject({ userId: "max", via: "app" });
    });

    it("falls back to the App when the user's GitHub account cannot write there", async () => {
      await createTask(writer("Sam Member"), await w.access("sam"), { repoNodeId: IDS.site, title: "From Sam" });
      expect(w.fake.writes).toEqual(["app POST /repos/acme/site/issues", "app addProjectV2ItemById"]);
    });

    it("refuses unlinked repos, Read Only, and bad field values before calling GitHub", async () => {
      await rejects(createTask(writer("Jane"), await w.access("jane"), { repoNodeId: IDS.internal, title: "Nope" }), 400);
      await rejects(createTask(writer("Rita"), await w.access("rita"), { repoNodeId: IDS.site, title: "Nope" }), 403);
      await rejects(
        createTask(writer("Jane"), await w.access("jane"), {
          repoNodeId: IDS.site,
          title: "Nope",
          fields: { [IDS.status]: { type: "single_select", optionId: "opt-from-another-field" } },
        }),
        400,
      );
      await rejects(
        createTask(writer("Jane"), await w.access("jane"), { repoNodeId: IDS.site, title: "Nope", fields: { F_title: { type: "text", text: "x" } } }),
        400,
      );
      expect(w.fake.writes).toEqual([]);
    });

    it("edits title, state, and Status, and the cache follows at once", async () => {
      const task = await updateTask(writer("Jane"), await w.access("jane"), "PVTI_site1", {
        title: "Homepage hero v2",
        state: "closed",
        stateReason: "completed",
        fields: { [IDS.status]: { type: "single_select", optionId: IDS.done }, [IDS.target]: { type: "date", date: "2026-07-01" } },
      });
      expect(task).toMatchObject({ title: "Homepage hero v2", state: "closed" });
      expect(task.fields[IDS.status]).toMatchObject({ name: "Done" });
      expect(task.fields[IDS.target]).toMatchObject({ date: "2026-07-01" });
      const cleared = await updateTask(writer("Jane"), await w.access("jane"), "PVTI_site1", { fields: { [IDS.target]: null } });
      expect(cleared.fields[IDS.target]).toBeUndefined();
      const actions = (await w.db.select().from(auditLog)).map((a) => a.action);
      expect(actions.filter((a) => a.startsWith("task."))).toEqual(["task.update", "task.fields", "task.fields"]);
    });

    it("keeps one attribution line when the App edits a body again", async () => {
      await updateTask(writer("Max Member"), await w.access("max"), "PVTI_site1", { body: "First." });
      const again = await updateTask(writer("Sam Member"), await w.access("sam"), "PVTI_site1", { body: "First.\n\n— Max Member via Gitwork\n\nSecond." });
      expect(again.body).toBe("First.\n\n— Max Member via Gitwork\n\nSecond.\n\n— Sam Member via Gitwork");
      const third = await updateTask(writer("Sam Member"), await w.access("sam"), "PVTI_site1", { body: again.body! });
      expect(third.body).toBe(again.body);
    });

    it("moves a draft between columns but does not edit its text", async () => {
      const moved = await updateTask(writer("Max"), await w.access("max"), "PVTI_draft", { fields: { [IDS.status]: { type: "single_select", optionId: IDS.todo } } });
      expect(moved.fields[IDS.status]).toMatchObject({ name: "Todo" });
      await rejects(updateTask(writer("Max"), await w.access("max"), "PVTI_draft", { title: "Renamed" }), 400);
    });

    it("cannot reach tasks the user cannot see, or write as Read Only", async () => {
      await rejects(updateTask(writer("Jane"), await w.access("jane"), "PVTI_int1", { title: "x" }), 404);
      await rejects(updateTask(writer("Rita"), await w.access("rita"), "PVTI_site1", { title: "x" }), 403);
      expect(w.fake.writes).toEqual([]);
    });

    it("records the issue even when adding it to the board fails", async () => {
      w.fake.projects.delete(IDS.board);
      await expect(createTask(writer("Jane"), await w.access("jane"), { repoNodeId: IDS.site, title: "Orphan" })).rejects.toThrow();
      expect((await w.db.select().from(ghIssues)).some((i) => i.title === "Orphan")).toBe(true);
      const [audit] = await w.db.select().from(auditLog).where(eq(auditLog.action, "task.create"));
      expect(audit?.detail).toMatchObject({ boardAdd: "failed" });
    });

    it("validates and audits workspace settings", async () => {
      await rejects(updateWorkspaceSettings(w.db, await w.access("max"), { hideLabel: "x" }), 403);
      await updateWorkspaceSettings(w.db, await w.access("jane"), { hideLabel: "  " });
      expect((await w.db.select().from(workspaces))[0]?.hideLabel).toBeNull();
    });
  });
});
