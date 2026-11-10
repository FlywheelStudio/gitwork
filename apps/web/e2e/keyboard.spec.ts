/**
 * Keyboard shortcuts and the command menu (roadmap Track C, decision 028). One test per group of
 * shortcuts in the keymap. GitHub is not reachable in E2E: the cache rows are written directly and
 * PATCH is answered by a stub that applies the change to the snapshot's task.
 */
import { type Page, type Route, expect, test } from "@playwright/test";
import { ghIssues, ghProjectFields, ghProjectItems, ghProjects, ghRepos, workspaceGithub, workspaceRepos } from "@gitwork/db";
import { openSqlite } from "@gitwork/db/node";
import { emailCount, lastEmail, signInCode } from "./outbox";

const N = 8;
const STATUS = [
  { id: "k-todo", name: "Todo" },
  { id: "k-doing", name: "Doing" },
  { id: "k-done", name: "Done" },
];
const PRIORITY = [
  { id: "k-high", name: "High" },
  { id: "k-low", name: "Low" },
];
const SPRINTS = { iterations: [{ id: "k-it2", title: "Sprint 2", startDate: "2026-11-16", duration: 14 }], completedIterations: [{ id: "k-it1", title: "Sprint 1", startDate: "2026-11-02", duration: 14 }] };

async function signIn(page: Page, email: string) {
  const before = emailCount(email);
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Email me a sign-in code" }).click();
  await page.getByLabel("Code").fill(await signInCode(email, before));
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}

async function seed(workspaceId: string) {
  const { db } = openSqlite("file:.data/e2e.sqlite");
  const now = new Date();
  const at = new Date("2026-05-01T00:00:00Z");
  const ns = Array.from({ length: N }, (_, i) => i + 1);
  await db.batch([
    db.insert(ghRepos).values({ nodeId: "R_kb", githubId: 601, installationId: 97, owner: "kbco", name: "web", fullName: "kbco/web", private: true, htmlUrl: "https://github.com/kbco/web", syncedAt: now }),
    db.insert(ghProjects).values({ nodeId: "PVT_kb", installationId: 97, ownerLogin: "kbco", number: 3, title: "Keys", url: "https://github.com/orgs/kbco/projects/3", syncedAt: now }),
    db.insert(ghProjectFields).values([
      { nodeId: "F_kstatus", projectNodeId: "PVT_kb", name: "Status", dataType: "SINGLE_SELECT", config: STATUS, syncedAt: now },
      { nodeId: "F_kprio", projectNodeId: "PVT_kb", name: "Priority", dataType: "SINGLE_SELECT", config: PRIORITY, syncedAt: now },
      { nodeId: "F_kest", projectNodeId: "PVT_kb", name: "Estimate", dataType: "NUMBER", config: null, syncedAt: now },
      { nodeId: "F_ktarget", projectNodeId: "PVT_kb", name: "Target date", dataType: "DATE", config: null, syncedAt: now },
      { nodeId: "F_ksprint", projectNodeId: "PVT_kb", name: "Sprint", dataType: "ITERATION", config: SPRINTS, syncedAt: now },
    ]),
    db.insert(ghIssues).values(
      ns.map((n) => ({
        nodeId: `I_kb#${n}`,
        repoNodeId: "R_kb",
        number: n,
        title: `Key task ${n}`,
        body: `Body ${n}`,
        state: "open",
        labels: [],
        assignees: [],
        htmlUrl: `https://github.com/kbco/web/issues/${n}`,
        createdAtGh: at,
        githubUpdatedAt: at,
        syncedAt: now,
      })),
    ),
    db.insert(ghProjectItems).values(
      ns.map((n) => ({
        nodeId: `PVTI_kb${n}`,
        projectNodeId: "PVT_kb",
        contentType: "ISSUE",
        contentNodeId: `I_kb#${n}`,
        fieldValues: { F_kstatus: { type: "single_select", optionId: "k-todo", name: "Todo" } } as never,
        githubUpdatedAt: at,
        syncedAt: now,
      })),
    ),
    db.insert(workspaceGithub).values({ workspaceId, installationId: 97, projectNodeId: "PVT_kb", linkedAt: now }),
    db.insert(workspaceRepos).values({ workspaceId, repoNodeId: "R_kb" }),
  ]);
}

type Task = { id: string; title: string; state: string; stateReason: string | null; fields: Record<string, unknown> };
type Field = { id: string; dataType: string; options?: { id: string; name: string }[]; iterations?: { id: string; title: string; startDate: string; duration: number }[] };

/** Answers PATCH /tasks/:id like the server would, from the current snapshot. Records each call. */
async function stubWrites(page: Page, workspaceId: string) {
  const res = await page.request.get(`/api/v1/workspaces/${workspaceId}/sync`);
  const snap = (await res.json()) as { board: { tasks: Task[]; fields: Field[] } };
  const tasks = new Map(snap.board.tasks.map((t) => [t.id, structuredClone(t)]));
  const calls: { id: string; body: Record<string, unknown> }[] = [];
  await page.route(`**/api/v1/workspaces/${workspaceId}/tasks/*`, async (route: Route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    const id = decodeURIComponent(route.request().url().split("/").pop()!);
    const body = route.request().postDataJSON() as { fields?: Record<string, Record<string, string | number> | null>; state?: string };
    calls.push({ id, body });
    const task = tasks.get(id)!;
    for (const [fieldId, input] of Object.entries(body.fields ?? {})) {
      const field = snap.board.fields.find((f) => f.id === fieldId)!;
      if (!input) delete task.fields[fieldId];
      else if (input.type === "single_select") task.fields[fieldId] = { ...input, name: field.options!.find((o) => o.id === input.optionId)!.name };
      else if (input.type === "iteration") {
        const it = field.iterations!.find((i) => i.id === input.iterationId)!;
        task.fields[fieldId] = { type: "iteration", iterationId: it.id, title: it.title, startDate: it.startDate, duration: it.duration };
      } else task.fields[fieldId] = input;
    }
    if (body.state) {
      task.state = body.state;
      task.stateReason = body.state === "closed" ? "completed" : null;
    }
    await route.fulfill({ json: { task } });
  });
  return calls;
}

const row = (page: Page, n: number) => page.locator(`[data-testid="task-row"][data-task-id="PVTI_kb${n}"]`);
const focusedId = (page: Page) => page.locator('[data-focused="true"]').getAttribute("data-task-id");

let workspaceId = "";

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  // Seeding plus sign-in can take longer than the default 30 s on a slow CI machine.
  test.setTimeout(120_000);
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const owner = await ctx.newPage();
  await signIn(owner, "keys-owner@example.com");
  await owner.getByLabel("Account name").fill("Keys Agency");
  await owner.getByLabel("First workspace").fill("Keys Board");
  await owner.getByRole("button", { name: "Create" }).click();
  await expect(owner.getByRole("heading", { name: "Keys Board" })).toBeVisible();
  workspaceId = /\/w\/([^/?#]+)/.exec(owner.url())![1]!;
  await seed(workspaceId);
  await ctx.storageState({ path: ".data/keys-owner.json" });

  // A Read Only member, for the "cannot edit" check.
  await owner.goto(`/w/${workspaceId}/members`);
  await owner.getByLabel("Email").fill("keys-reader@example.com");
  await owner.getByLabel("Role").selectOption("read_only");
  await owner.getByRole("button", { name: "Send invite" }).click();
  const [, invitePath] = await lastEmail("keys-reader@example.com", /http:\/\/localhost:\d+(\/invite\/[A-Za-z0-9_-]+)/);
  const rctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const reader = await rctx.newPage();
  await signIn(reader, "keys-reader@example.com");
  await reader.goto(invitePath!);
  await reader.getByRole("button", { name: "Accept invite" }).click();
  await expect(reader.getByText("Your role: Read Only")).toBeVisible();
  await rctx.storageState({ path: ".data/keys-reader.json" });
  await rctx.close();
  await ctx.close();
});

test.use({ storageState: ".data/keys-owner.json", permissions: ["clipboard-read", "clipboard-write"] });

async function open(page: Page, view = "list") {
  await page.goto(`/w/${workspaceId}?view=${view}`);
  await expect(page.getByTestId(view === "board" ? "task-card" : view === "timeline" ? "timeline-row" : "task-row")).toHaveCount(N);
}

test("? shows every shortcut; Escape closes it", async ({ page }) => {
  await open(page);
  await page.keyboard.press("?");
  const sheet = page.getByTestId("shortcut-sheet");
  await expect(sheet).toBeVisible();
  for (const label of ["Open command menu", "Go to settings", "Switch list ↔ board", "Move down", "Set status", "Copy branch name"]) {
    await expect(sheet.getByText(label, { exact: true })).toBeVisible();
  }
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
});

test("J / K / arrows move focus; Space opens the panel, which follows focus; Escape steps back", async ({ page }) => {
  await open(page);
  await page.keyboard.press("j");
  expect(await focusedId(page)).toBe("PVTI_kb1");
  await page.keyboard.press("j");
  await page.keyboard.press("ArrowDown");
  expect(await focusedId(page)).toBe("PVTI_kb3");
  await page.keyboard.press("k");
  expect(await focusedId(page)).toBe("PVTI_kb2");
  await page.keyboard.press(" ");
  const panel = page.getByTestId("peek-panel");
  await expect(panel.getByRole("heading", { name: "Key task 2" })).toBeVisible();
  await page.keyboard.press("j");
  await expect(panel.getByRole("heading", { name: "Key task 3" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  expect(await focusedId(page)).toBe("PVTI_kb3");
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-focused="true"]')).toHaveCount(0);
});

test("Enter opens the focused task's page", async ({ page }) => {
  await open(page);
  await page.keyboard.press("j");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/w/${workspaceId}/tasks/PVTI_kb1$`));
});

test("X selects, Shift+J extends, mod+A selects all, Escape clears", async ({ page }) => {
  await open(page);
  await page.keyboard.press("j");
  await page.keyboard.press("x");
  await expect(page.getByTestId("selection-bar")).toContainText("1 selected");
  await page.keyboard.press("Shift+J");
  await page.keyboard.press("Shift+ArrowDown");
  await expect(page.getByTestId("selection-bar")).toContainText("3 selected");
  await page.keyboard.press("ControlOrMeta+a");
  await expect(page.getByTestId("selection-bar")).toContainText(`${N} selected`);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("selection-bar")).toHaveCount(0);
});

test("S sets status on the focused task, optimistically", async ({ page }) => {
  await open(page);
  const calls = await stubWrites(page, workspaceId);
  await page.keyboard.press("j");
  await page.keyboard.press("s");
  await page.getByRole("option", { name: "Doing" }).click();
  await expect(row(page, 1)).toContainText("Doing");
  expect(calls).toEqual([{ id: "PVTI_kb1", body: { fields: { F_kstatus: { type: "single_select", optionId: "k-doing" } } } }]);
});

test("S on a selection edits every selected task; mod+Z undoes them as one step", async ({ page }) => {
  await open(page);
  const calls = await stubWrites(page, workspaceId);
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("j");
    await page.keyboard.press("x");
  }
  await page.keyboard.press("s");
  await page.getByRole("dialog").getByPlaceholder(/Set Status for 3 tasks/).fill("done");
  await page.keyboard.press("Enter");
  for (const n of [1, 2, 3]) await expect(row(page, n)).toContainText("Done");
  await expect(row(page, 4)).toContainText("Todo");
  await expect(page.getByRole("status")).toContainText("Updated Status on 3 tasks");
  expect(calls.map((c) => c.id)).toEqual(["PVTI_kb1", "PVTI_kb2", "PVTI_kb3"]);

  await page.keyboard.press("Escape"); // clear the selection first: Escape never undoes
  await page.keyboard.press("ControlOrMeta+z");
  for (const n of [1, 2, 3]) await expect(row(page, n)).toContainText("Todo");
  await expect(page.getByRole("status")).toContainText("Undone: Status change on 3 tasks");
  expect(calls).toHaveLength(6);
});

test("P, E, Shift+D, Shift+C edit priority, estimate, due date, and cycle", async ({ page }) => {
  await open(page);
  const calls = await stubWrites(page, workspaceId);
  await page.keyboard.press("j");
  await page.keyboard.press("p");
  await page.getByRole("option", { name: "High" }).click();
  await page.keyboard.press("e");
  await page.getByRole("dialog").getByLabel("Estimate").fill("5");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Shift+D");
  await page.getByRole("dialog").getByLabel("Target date").fill("2026-12-24");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Shift+C");
  await page.getByRole("option", { name: "Sprint 2" }).click();
  await expect.poll(() => calls.length).toBe(4);
  expect(calls.map((c) => c.body.fields)).toEqual([
    { F_kprio: { type: "single_select", optionId: "k-high" } },
    { F_kest: { type: "number", number: 5 } },
    { F_ktarget: { type: "date", date: "2026-12-24" } },
    { F_ksprint: { type: "iteration", iterationId: "k-it2" } },
  ]);
  await expect(row(page, 1).locator("time")).toHaveAttribute("datetime", "2026-12-24");
  await expect(row(page, 1)).toContainText("Dec 24");
});

test("mod+Shift+X closes and reopens the focused task", async ({ page }) => {
  await open(page);
  const calls = await stubWrites(page, workspaceId);
  await page.keyboard.press("j");
  await page.keyboard.press("ControlOrMeta+Shift+X");
  await expect(row(page, 1)).toContainText("Closed");
  await page.keyboard.press("ControlOrMeta+Shift+X");
  await expect(row(page, 1)).not.toContainText("Closed");
  expect(calls.map((c) => c.body.state)).toEqual(["closed", "open"]);
});

test("mod+. copies the ID, mod+Shift+, the URL, mod+Shift+. a branch name", async ({ page }) => {
  await open(page);
  await page.keyboard.press("j");
  const clip = () => page.evaluate(() => navigator.clipboard.readText());
  await page.keyboard.press("ControlOrMeta+.");
  await expect.poll(clip).toBe("kbco/web#1");
  await page.keyboard.press("ControlOrMeta+Shift+Comma");
  await expect.poll(clip).toBe(`${new URL(page.url()).origin}/w/${workspaceId}/tasks/PVTI_kb1`);
  await page.keyboard.press("ControlOrMeta+Shift+Period");
  await expect.poll(clip).toBe("1-key-task-1");
});

test("mod+K runs commands and finds tasks; / searches tasks", async ({ page }) => {
  await open(page);
  await page.keyboard.press("ControlOrMeta+k");
  const menu = page.getByRole("dialog");
  await expect(menu.getByRole("option", { name: /New task/ })).toBeVisible();
  await menu.getByRole("combobox").fill("timeline");
  await page.keyboard.press("Enter");
  // The seeded tasks have no dates: the timeline lists them as unscheduled.
  await expect(page.getByRole("heading", { name: "Unscheduled" })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("view")).toBe("timeline");

  await page.keyboard.press("/");
  await page.getByRole("dialog").getByRole("combobox").fill("Key task 6");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("peek-panel").getByRole("heading", { name: "Key task 6" })).toBeVisible();
});

test("mod+B toggles list and board; V then T shows the timeline", async ({ page }) => {
  await open(page);
  await page.keyboard.press("ControlOrMeta+b");
  await expect(page.getByTestId("task-card")).toHaveCount(N);
  await page.keyboard.press("ControlOrMeta+b");
  await expect(page.getByTestId("task-row")).toHaveCount(N);
  await page.keyboard.press("v");
  await page.keyboard.press("t");
  await expect(page.getByRole("heading", { name: "Unscheduled" })).toBeVisible();
});

test("G then S opens settings; members is in the command menu; G then M stays free for My tasks", async ({ page }) => {
  await open(page);
  await page.keyboard.press("g");
  await page.keyboard.press("m"); // reserved (Linear: My tasks): does nothing yet
  await expect(page).toHaveURL(new RegExp(`/w/${workspaceId}\\?view=list$`));
  await page.keyboard.press("g");
  await page.keyboard.press("s");
  await expect(page).toHaveURL(new RegExp(`/w/${workspaceId}/settings$`));
  await open(page);
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("dialog").getByRole("combobox").fill("go to members");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/w/${workspaceId}/members$`));
});

test("C opens the new-task dialog", async ({ page }) => {
  await open(page);
  await page.keyboard.press("c");
  await expect(page.getByRole("dialog").getByRole("heading", { name: "New task" })).toBeVisible();
  // Typing in the dialog's fields never triggers shortcuts.
  await page.getByLabel("Title").fill("s j x");
  await expect(page.getByRole("dialog").getByRole("heading", { name: "New task" })).toBeVisible();
  await expect(page.getByLabel("Title")).toHaveValue("s j x");
});

test("keys typed in a field stay in the field", async ({ page }) => {
  await open(page);
  await page.keyboard.press("j");
  await page.keyboard.press(" ");
  const est = page.getByTestId("peek-panel").getByLabel("Estimate");
  await est.click();
  await page.keyboard.type("3");
  await page.keyboard.press("s"); // would open the status picker outside a field
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // Positive control: the same key outside the field opens the picker.
  await page.keyboard.press("Escape"); // drops the draft, keeps the panel
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("s");
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("keys work on every workspace page, and the store survives moving between pages", async ({ page }) => {
  await open(page);
  // Focus lives only in the client store: if it survives the round trip, so did the store.
  await page.keyboard.press("j");
  await page.keyboard.press("j");
  let documents = 0;
  page.on("request", (r) => {
    if (r.isNavigationRequest()) documents++;
  });
  await page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Members" }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${workspaceId}/members$`));
  await page.keyboard.press("?");
  await expect(page.getByTestId("shortcut-sheet")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("dialog").getByRole("combobox").fill("Key task 5");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("peek-panel").getByRole("heading", { name: "Key task 5" })).toBeVisible();
  await page.keyboard.press("Escape");
  // Back to tasks: the same store, so the focus set from the menu on the Members page (task 5)
  // is still there; no page load on the way.
  await page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Tasks" }).click();
  await expect(page.getByTestId("task-row")).toHaveCount(N);
  expect(await focusedId(page)).toBe("PVTI_kb5");
  expect(documents).toBe(0);
  await expect(page.getByTestId("sync-status")).toContainText("Synced");
});

test("the panel and the new-task dialog say where an edit goes", async ({ page }) => {
  await open(page);
  await page.keyboard.press("j");
  await page.keyboard.press(" ");
  // This owner has not linked GitHub: the app writes, with their name.
  await expect(page.getByTestId("peek-panel").getByTestId("write-path")).toHaveText("Edits save to GitHub through the Gitwork app, signed with your name.");
  await page.keyboard.press("Escape");
  await page.keyboard.press("c");
  await expect(page.getByRole("dialog").getByTestId("write-path")).toBeVisible();
});

test("dark mode follows the system setting", async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: ".data/keys-owner.json", colorScheme: "dark" });
  const page = await ctx.newPage();
  await page.goto(`/w/${workspaceId}`);
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
  await ctx.close();
});

test.describe("as Read Only", () => {
  test.use({ storageState: ".data/keys-reader.json" });

  test("edit keys explain the role and send nothing; reading keys work", async ({ page }) => {
    await open(page);
    let writes = 0;
    page.on("request", (r) => {
      if (r.method() === "PATCH") writes++;
    });
    await page.keyboard.press("j");
    await page.keyboard.press("s");
    await expect(page.getByRole("status")).toContainText("Your role cannot edit tasks.");
    await page.keyboard.press("c");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.keyboard.press(" ");
    await expect(page.getByTestId("peek-panel").getByRole("heading", { name: "Key task 1" })).toBeVisible();
    await expect(page.getByTestId("write-path")).toHaveCount(0);
    expect(writes).toBe(0);
  });
});

