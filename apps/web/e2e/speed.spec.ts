/**
 * Speed budgets (roadmap Track B, decision 033) on a 2,000-task board:
 * - the first poll after a page load is a 304 (the page and /sync agree on the ETag);
 * - switching list / board / timeline sends no request and renders within budget;
 * - a task opens in the side panel without a page load;
 * - an edit shows before the server answers, and rolls back when the server refuses.
 * GitHub is not reachable in E2E, so the test writes the cache rows directly and stubs PATCH.
 */
import { type Page, type Request, expect, test } from "@playwright/test";
import { ghIssues, ghProjectFields, ghProjectItems, ghProjects, ghRepos, workspaceGithub, workspaceRepos } from "@gitwork/db";
import { openSqlite } from "@gitwork/db/node";
import { emailCount, signInCode } from "./outbox";

const TASKS = 2_000;
/** Script time for one view switch, measured in the page. Generous for CI machines; local runs are far lower. */
const SWITCH_BUDGET_MS = Number(process.env.SWITCH_BUDGET_MS ?? 400);

async function signIn(page: Page, email: string) {
  const before = emailCount(email);
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Email me a sign-in code" }).click();
  await page.getByLabel("Code").fill(await signInCode(email, before));
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}

async function seedBigBoard(workspaceId: string) {
  const { db } = openSqlite("file:.data/e2e.sqlite");
  const now = new Date();
  const at = new Date("2026-05-01T00:00:00Z");
  const options = [
    { id: "s-todo", name: "Todo" },
    { id: "s-doing", name: "Doing" },
    { id: "s-done", name: "Done" },
  ];
  await db.batch([
    db.insert(ghRepos).values({
      nodeId: "R_big",
      githubId: 501,
      installationId: 98,
      owner: "bigco",
      name: "app",
      fullName: "bigco/app",
      private: true,
      htmlUrl: "https://github.com/bigco/app",
      syncedAt: now,
    }),
    db.insert(ghProjects).values({ nodeId: "PVT_big", installationId: 98, ownerLogin: "bigco", number: 5, title: "Big", url: "https://github.com/orgs/bigco/projects/5", syncedAt: now }),
    db.insert(ghProjectFields).values([
      { nodeId: "F_bstatus", projectNodeId: "PVT_big", name: "Status", dataType: "SINGLE_SELECT", config: options, syncedAt: now },
      { nodeId: "F_bstart", projectNodeId: "PVT_big", name: "Start date", dataType: "DATE", config: null, syncedAt: now },
      { nodeId: "F_btarget", projectNodeId: "PVT_big", name: "Target date", dataType: "DATE", config: null, syncedAt: now },
    ]),
    db.insert(workspaceGithub).values({ workspaceId, installationId: 98, projectNodeId: "PVT_big", linkedAt: now }),
    db.insert(workspaceRepos).values({ workspaceId, repoNodeId: "R_big" }),
  ]);
  const day = (n: number) => new Date(Date.UTC(2026, 5, 1 + (n % 60))).toISOString().slice(0, 10);
  for (let start = 1; start <= TASKS; start += 200) {
    const ns = Array.from({ length: Math.min(200, TASKS - start + 1) }, (_, i) => start + i);
    await db.batch([
      db.insert(ghIssues).values(
        ns.map((n) => ({
          nodeId: `I_big#${n}`,
          repoNodeId: "R_big",
          number: n,
          title: `Task number ${n}`,
          body: `Body of task ${n}`,
          state: "open",
          labels: [],
          assignees: [],
          htmlUrl: `https://github.com/bigco/app/issues/${n}`,
          createdAtGh: at,
          githubUpdatedAt: at,
          syncedAt: now,
        })),
      ),
      db.insert(ghProjectItems).values(
        ns.map((n) => {
          const o = options[n % 3]!;
          return {
            nodeId: `PVTI_big${n}`,
            projectNodeId: "PVT_big",
            contentType: "ISSUE",
            contentNodeId: `I_big#${n}`,
            fieldValues: {
              F_bstatus: { type: "single_select", optionId: o.id, name: o.name },
              F_bstart: { type: "date", date: day(n) },
              F_btarget: { type: "date", date: day(n + 3) },
            } as never,
            githubUpdatedAt: at,
            syncedAt: now,
          };
        }),
      ),
    ]);
  }
}

let workspaceId = "";

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  // A clean context: test.use's storageState below does not exist yet.
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await signIn(page, "speed-owner@example.com");
  await page.getByLabel("Account name").fill("Speed Agency");
  await page.getByLabel("First workspace").fill("Speed Board");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("heading", { name: "Speed Board" })).toBeVisible();
  workspaceId = /\/w\/([^/?#]+)/.exec(page.url())![1]!;
  await seedBigBoard(workspaceId);
  await context.storageState({ path: ".data/speed-owner.json" });
  await context.close();
});

test.use({ storageState: ".data/speed-owner.json" });

/**
 * Requests other than the background poll and Next.js link prefetches. Next re-prefetches the
 * header and nav links after the URL changes; those warm its router cache and carry no task data.
 */
function watchRequests(page: Page) {
  const seen: string[] = [];
  const prefetches: string[] = [];
  const onRequest = (r: Request) => {
    if (r.url().includes("/sync")) return;
    if (r.headers()["next-router-prefetch"]) prefetches.push(r.url());
    else seen.push(`${r.method()} ${r.url()}`);
  };
  page.on("request", onRequest);
  return { seen, prefetches, stop: () => page.off("request", onRequest) };
}

/**
 * Clicks a view button and returns the time until the new view's `count` items are in the DOM.
 * React commits in a microtask after the click, so the clock stops on the DOM, not on click().
 */
async function switchView(page: Page, label: string, testId: string, count: number): Promise<number> {
  return page.evaluate(
    ({ name, testId, count }) =>
      new Promise<number>((resolve) => {
        const button = [...document.querySelectorAll<HTMLButtonElement>('nav[aria-label="Views"] button')].find((b) => b.textContent === name)!;
        const done = () => document.querySelectorAll(`[data-testid="${testId}"]`).length === count;
        const t0 = performance.now();
        const observer = new MutationObserver(() => {
          if (!done()) return;
          observer.disconnect();
          resolve(performance.now() - t0);
        });
        observer.observe(document.body, { childList: true, subtree: true });
        button.click();
      }),
    { name: label, testId, count },
  );
}

test("the first poll is a 304: the page and /sync agree", async ({ page }) => {
  await page.goto(`/w/${workspaceId}`);
  await expect(page.getByTestId("task-row")).toHaveCount(TASKS);
  const poll = page.waitForResponse((r) => r.url().endsWith(`/workspaces/${workspaceId}/sync`));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  expect((await poll).status()).toBe(304);
});

test("switching views sends no request and stays within budget", async ({ page }) => {
  await page.goto(`/w/${workspaceId}?view=list`);
  await expect(page.getByTestId("task-row")).toHaveCount(TASKS);
  const requests = watchRequests(page);
  const times: Record<string, number> = {};
  for (const [label, testId] of [
    ["Board", "task-card"],
    ["Timeline", "timeline-row"],
    ["List", "task-row"],
  ] as const) {
    times[label] = await switchView(page, label, testId, TASKS);
    await expect(page.getByTestId(testId)).toHaveCount(TASKS);
  }
  requests.stop();
  console.log(`[speed] view switch script ms: ${JSON.stringify(times)}`);
  expect(requests.seen).toEqual([]);
  // No prefetch may load the workspace's tasks page data under another name.
  for (const url of requests.prefetches) expect(url).not.toContain("/tasks/");
  expect(new URL(page.url()).searchParams.get("view")).toBe("list");
  for (const [label, ms] of Object.entries(times)) expect(ms, `${label} switch`).toBeLessThan(SWITCH_BUDGET_MS);
});

test("a task opens in the side panel without a page load", async ({ page }) => {
  await page.goto(`/w/${workspaceId}?view=list`);
  const url = page.url();
  // A page load would be a document request or a non-prefetch server-component request.
  const loads: string[] = [];
  page.on("request", (r) => {
    if (r.isNavigationRequest() || (r.url().includes("_rsc") && !r.headers()["next-router-prefetch"])) loads.push(r.url());
  });
  await page.getByRole("link", { name: "Task number 7", exact: true }).click();
  const panel = page.getByTestId("peek-panel");
  await expect(panel.getByRole("heading", { name: "Task number 7" })).toBeVisible();
  await expect(panel.getByText("Body of task 7")).toBeVisible();
  expect(page.url()).toBe(url);
  expect(loads).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
});

test("an edit shows before the server answers, and rolls back on refusal", async ({ page }) => {
  await page.goto(`/w/${workspaceId}?view=list`);
  const row = page.getByTestId("task-row").filter({ has: page.getByRole("link", { name: "Task number 9", exact: true }) });
  await expect(row).toContainText("Todo"); // 9 % 3 = 0 → Todo

  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  await page.route(`**/api/v1/workspaces/${workspaceId}/tasks/PVTI_big9`, async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    await gate;
    await route.fulfill({ status: 502, json: { error: { code: "github_error", message: "GitHub refused the request." } } });
  });

  await page.getByRole("link", { name: "Task number 9", exact: true }).click();
  await page.getByTestId("peek-panel").getByLabel("Status").selectOption({ label: "Done" });
  // Before the server answers: the row already shows the new status.
  await expect(row).toContainText("Done");
  release();
  await expect(page.getByRole("status")).toContainText("Could not change Status");
  await expect(row).toContainText("Todo");
});

test("a successful edit keeps the server's answer", async ({ page }) => {
  await page.goto(`/w/${workspaceId}?view=list`);
  const row = page.getByTestId("task-row").filter({ has: page.getByRole("link", { name: "Task number 10", exact: true }) });
  await expect(row).toContainText("Doing"); // 10 % 3 = 1
  const sync = await page.request.get(`/api/v1/workspaces/${workspaceId}/sync`);
  const task = ((await sync.json()) as { board: { tasks: { id: string; fields: Record<string, unknown> }[] } }).board.tasks.find(
    (t) => t.id === "PVTI_big10",
  )!;
  await page.route(`**/api/v1/workspaces/${workspaceId}/tasks/PVTI_big10`, async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    await route.fulfill({
      json: { task: { ...task, fields: { ...task.fields, F_bstatus: { type: "single_select", optionId: "s-done", name: "Done" } } } },
    });
  });
  await page.getByRole("link", { name: "Task number 10", exact: true }).click();
  await page.getByTestId("peek-panel").getByLabel("Status").selectOption({ label: "Done" });
  await expect(row).toContainText("Done");
});
