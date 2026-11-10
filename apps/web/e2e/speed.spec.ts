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
const SWITCH_BUDGET_MS = Number(process.env.SWITCH_BUDGET_MS ?? 150);
/** One J press on a 2,000-row list. Only two rows may re-render. */
const FOCUS_BUDGET_MS = Number(process.env.FOCUS_BUDGET_MS ?? 16);

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
  // Seeding plus sign-in can take longer than the default 30 s on a slow CI machine.
  test.setTimeout(120_000);
  // A clean context: test.use's storageState below does not exist yet.
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await signIn(page, "speed-owner@example.com");
  // The onboarding form is covered by identity.spec.ts; here the API is enough.
  const created = await page.request.post("/api/v1/accounts", {
    data: { accountName: "Speed Agency", workspaceName: "Speed Board" },
    headers: { origin: new URL(page.url()).origin },
  });
  expect(created.status(), await created.text()).toBe(200);
  workspaceId = ((await created.json()) as { workspaceId: string }).workspaceId;
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
 * Clicks a view button and returns the time until the new view's first item is in the DOM.
 * React commits in a microtask after the click, so the clock stops on the DOM, not on click().
 */
async function switchView(page: Page, label: string, testId: string): Promise<number> {
  return page.evaluate(
    ({ name, testId }) =>
      new Promise<number>((resolve) => {
        const button = [...document.querySelectorAll<HTMLButtonElement>('nav[aria-label="Views"] button')].find((b) => b.textContent === name)!;
        const done = () => document.querySelector(`[data-testid="${testId}"]`) !== null;
        const t0 = performance.now();
        const observer = new MutationObserver(() => {
          if (!done()) return;
          observer.disconnect();
          resolve(performance.now() - t0);
        });
        observer.observe(document.body, { childList: true, subtree: true });
        button.click();
      }),
    { name: label, testId },
  );
}

test("the /sync payload at 2,000 tasks (measured for decision 033)", async ({ page }) => {
  await page.goto(`/w/${workspaceId}`);
  const t0 = Date.now();
  const res = await page.request.get(`/api/v1/workspaces/${workspaceId}/sync`);
  const ms = Date.now() - t0;
  const bytes = (await res.body()).length;
  const etag = res.headers()["etag"]!;
  const t1 = Date.now();
  const again = await page.request.get(`/api/v1/workspaces/${workspaceId}/sync`, { headers: { "if-none-match": etag } });
  const ms304 = Date.now() - t1;
  console.log(`[speed] /sync 200: ${(bytes / 1024).toFixed(0)} KiB uncompressed in ${ms} ms; 304 in ${ms304} ms`);
  expect(again.status()).toBe(304);
});

test("the list renders only rows near the viewport, and J reaches rows far below", async ({ page }) => {
  await page.goto(`/w/${workspaceId}?view=list`);
  await expect(page.getByTestId("task-row").first()).toBeVisible();
  const rendered = await page.getByTestId("task-row").count();
  console.log(`[speed] list rows in the DOM: ${rendered} of ${TASKS}`);
  expect(rendered).toBeLessThan(150);
  // The Todo group holds every third task; 100 J presses go far past the first screen.
  for (let i = 0; i < 100; i++) await page.keyboard.press("j");
  const focused = page.locator('[data-focused="true"]');
  await expect(focused).toBeInViewport();
  expect(await focused.getAttribute("data-task-id")).toBe("PVTI_big300"); // the 100th Todo task: 3, 6, …, 300
});

test("the timeline draws only rows near the viewport, and J reaches rows far below", async ({ page }) => {
  await page.goto(`/w/${workspaceId}?view=timeline`);
  await expect(page.getByTestId("timeline-row").first()).toBeVisible();
  // One read of both counts: the timeline may re-render between two separate reads.
  const { labels, bars } = await page.evaluate(() => ({
    labels: document.querySelectorAll('[data-testid="timeline-row"]').length,
    bars: document.querySelectorAll('[data-testid="timeline-bar"]').length,
  }));
  console.log(`[speed] timeline rows in the DOM: ${labels} labels, ${bars} bars of ${TASKS}`);
  expect(labels).toBeLessThan(150);
  expect(bars).toBe(labels);
  for (let i = 0; i < 200; i++) await page.keyboard.press("j");
  const focused = page.locator('[data-focused="true"]');
  await expect(focused).toBeInViewport();
  expect(await focused.getAttribute("data-task-id")).toBe("PVTI_big200"); // timeline order is board order
});

test("the first poll is a 304: the page and /sync agree", async ({ page }) => {
  await page.goto(`/w/${workspaceId}`);
  await expect(page.getByTestId("task-row").first()).toBeVisible();
  const poll = page.waitForResponse((r) => r.url().endsWith(`/workspaces/${workspaceId}/sync`));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  expect((await poll).status()).toBe(304);
});

test("switching views sends no request and stays within budget", async ({ page }) => {
  await page.goto(`/w/${workspaceId}?view=list`);
  await expect(page.getByTestId("task-row").first()).toBeVisible();
  const requests = watchRequests(page);
  const times: Record<string, number> = {};
  for (const [label, testId] of [
    ["Board", "task-card"],
    ["Timeline", "timeline-row"],
    ["List", "task-row"],
  ] as const) {
    times[label] = await switchView(page, label, testId);
    await expect(page.getByTestId(testId).first()).toBeVisible();
  }
  requests.stop();
  console.log(`[speed] view switch script ms: ${JSON.stringify(times)}`);
  expect(requests.seen).toEqual([]);
  // No prefetch may load the workspace's tasks page data under another name.
  for (const url of requests.prefetches) expect(url).not.toContain("/tasks/");
  expect(new URL(page.url()).searchParams.get("view")).toBe("list");
  for (const [label, ms] of Object.entries(times)) expect(ms, `${label} switch`).toBeLessThan(SWITCH_BUDGET_MS);
});

test("J moves focus within budget on 2,000 rows", async ({ page }) => {
  await page.goto(`/w/${workspaceId}?view=list`);
  await expect(page.getByTestId("task-row").first()).toBeVisible();
  await page.keyboard.press("j"); // focus the first row
  await expect(page.locator('[data-focused="true"]')).toHaveCount(1);
  const times = await page.evaluate(async () => {
    const out: number[] = [];
    for (let i = 0; i < 10; i++) {
      const before = document.querySelector('[data-focused="true"]');
      const t0 = performance.now();
      await new Promise<void>((resolve) => {
        const observer = new MutationObserver(() => {
          const now = document.querySelector('[data-focused="true"]');
          if (now && now !== before) {
            observer.disconnect();
            resolve();
          }
        });
        observer.observe(document.body, { attributes: true, subtree: true, attributeFilter: ["data-focused"] });
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true }));
      });
      out.push(performance.now() - t0);
    }
    return out;
  });
  const worst = Math.max(...times);
  console.log(`[speed] J focus move ms (10 presses): worst ${worst.toFixed(1)}, median ${[...times].sort((a, b) => a - b)[5]!.toFixed(1)}`);
  expect(worst).toBeLessThan(FOCUS_BUDGET_MS);
});

test("a task opens in the side panel without a page load", async ({ page }) => {
  await page.goto(`/w/${workspaceId}?view=list`);
  const url = page.url();
  // A page load would be a document request or a non-prefetch server-component request.
  const loads: string[] = [];
  page.on("request", (r) => {
    if (r.isNavigationRequest() || (r.url().includes("_rsc") && !r.headers()["next-router-prefetch"])) loads.push(r.url());
  });
  await page.getByRole("link", { name: "Task number 3", exact: true }).click();
  const panel = page.getByTestId("peek-panel");
  await expect(panel.getByRole("heading", { name: "Task number 3" })).toBeVisible();
  await expect(panel.getByText("Body of task 3")).toBeVisible();
  expect(page.url()).toBe(url);
  expect(loads).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
});

test("an edit shows before the server answers, and rolls back on refusal", async ({ page }) => {
  await page.goto(`/w/${workspaceId}?view=list`);
  // The row moves to another status group when the status changes, so watch the store through the
  // panel's Status field, and the Todo group's count in its header.
  const todoHeader = page.getByRole("heading", { name: /^Todo/ });
  await expect(todoHeader).toContainText("666"); // n % 3 = 0: 3, 6, …, 1998

  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  await page.route(`**/api/v1/workspaces/${workspaceId}/tasks/PVTI_big9`, async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    await gate;
    await route.fulfill({ status: 502, json: { error: { code: "github_error", message: "GitHub refused the request." } } });
  });

  await page.getByRole("link", { name: "Task number 9", exact: true }).click();
  const status = page.getByTestId("peek-panel").getByLabel("Status");
  await status.selectOption({ label: "Done" });
  // Before the server answers: the task has already left the Todo group.
  await expect(status).toHaveValue("s-done");
  await expect(todoHeader).toContainText("665");
  release();
  await expect(page.getByRole("status")).toContainText("Could not change Status");
  await expect(status).toHaveValue("s-todo");
  await expect(todoHeader).toContainText("666");
});

test("a successful edit keeps the server's answer", async ({ page }) => {
  await page.goto(`/w/${workspaceId}?view=list`);
  // The Done group is far below the first screen (virtualized), so watch the panel's Status field.
  const sync = await page.request.get(`/api/v1/workspaces/${workspaceId}/sync`);
  const task = ((await sync.json()) as { board: { tasks: { id: string; fields: Record<string, unknown> }[] } }).board.tasks.find(
    (t) => t.id === "PVTI_big6",
  )!;
  await page.route(`**/api/v1/workspaces/${workspaceId}/tasks/PVTI_big6`, async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    await route.fulfill({
      json: { task: { ...task, fields: { ...task.fields, F_bstatus: { type: "single_select", optionId: "s-done", name: "Done" } } } },
    });
  });
  await page.getByRole("link", { name: "Task number 6", exact: true }).click();
  const status = page.getByTestId("peek-panel").getByLabel("Status");
  await status.selectOption({ label: "Done" });
  await expect(status).toHaveValue("s-done");
  // After the stubbed success the server's answer stays: no rollback, no notice.
  await page.waitForTimeout(300);
  await expect(status).toHaveValue("s-done");
  await expect(page.getByRole("status")).not.toContainText("Could not");
});
