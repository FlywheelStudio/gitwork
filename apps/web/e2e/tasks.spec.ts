/**
 * Phase 3 exit check (docs/spec.md): a Read Only user never receives a hidden item or a task from
 * an unlinked repo — not in the API, not in any view, not as a link.
 *
 * GitHub is not reachable in E2E, so the test writes the cache rows a linked workspace would have.
 * The unlinked repo's issues are in the cache on purpose: webhooks cache every installed repo.
 */
import { type BrowserContext, type Page, expect, test } from "@playwright/test";
import {
  ghIssueLinks,
  ghIssues,
  ghProjectFields,
  ghProjectItems,
  ghProjects,
  ghRepos,
  workspaceGithub,
  workspaceRepos,
} from "@gitwork/db";
import { openSqlite } from "@gitwork/db/node";
import { lastEmail, signInCode } from "./outbox";

const SECRETS = ["Secret roadmap", "Internal pricing notes", "Idea: dark mode", "PVTI_int1", "PVTI_hidden", "PVTI_draft"];

async function signIn(page: Page, email: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Email me a sign-in code" }).click();
  await page.getByLabel("Code").fill(await signInCode(email));
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}

async function seedLinkedBoard(workspaceId: string) {
  const { db } = openSqlite("file:.data/e2e.sqlite");
  const now = new Date();
  const at = new Date("2026-05-01T00:00:00Z");
  const repo = (nodeId: string, name: string, id: number) => ({
    nodeId,
    githubId: id,
    installationId: 99,
    owner: "acme",
    name,
    fullName: `acme/${name}`,
    private: true,
    htmlUrl: `https://github.com/acme/${name}`,
    syncedAt: now,
  });
  const issue = (repoNodeId: string, name: string, number: number, title: string, labels: string[] = []) => ({
    nodeId: `I_${name}#${number}`,
    repoNodeId,
    number,
    title,
    body: `${title} body`,
    state: "open",
    labels: labels.map((l) => ({ name: l, color: "ededed" })),
    assignees: [],
    htmlUrl: `https://github.com/acme/${name}/issues/${number}`,
    createdAtGh: at,
    githubUpdatedAt: at,
    syncedAt: now,
  });
  const item = (nodeId: string, content: string | null, values: Record<string, unknown>, draftTitle?: string) => ({
    nodeId,
    projectNodeId: "PVT_1",
    contentType: draftTitle ? "DRAFT_ISSUE" : "ISSUE",
    contentNodeId: content,
    draftTitle: draftTitle ?? null,
    fieldValues: values as never,
    githubUpdatedAt: at,
    syncedAt: now,
  });
  const todo = { F_status: { type: "single_select", optionId: "opt-todo", name: "Todo" } };
  const dated = (start: string, target: string) => ({ ...todo, F_start: { type: "date", date: start }, F_target: { type: "date", date: target } });
  await db.batch([
    db.insert(ghRepos).values([repo("R_site", "site", 1), repo("R_internal", "internal", 2)]),
    db.insert(ghIssues).values([
      issue("R_site", "site", 1, "Homepage hero"),
      issue("R_site", "site", 2, "Internal pricing notes", ["Internal"]),
      issue("R_site", "site", 3, "Pricing table"),
      issue("R_internal", "internal", 1, "Secret roadmap"),
    ]),
    db.insert(ghProjects).values({ nodeId: "PVT_1", installationId: 99, ownerLogin: "acme", number: 1, title: "Website", url: "https://github.com/orgs/acme/projects/1", syncedAt: now }),
    db.insert(ghProjectFields).values([
      { nodeId: "F_status", projectNodeId: "PVT_1", name: "Status", dataType: "SINGLE_SELECT", config: [{ id: "opt-todo", name: "Todo" }, { id: "opt-done", name: "Done" }], syncedAt: now },
      { nodeId: "F_start", projectNodeId: "PVT_1", name: "Start date", dataType: "DATE", config: null, syncedAt: now },
      { nodeId: "F_target", projectNodeId: "PVT_1", name: "Target date", dataType: "DATE", config: null, syncedAt: now },
    ]),
    db.insert(ghProjectItems).values([
      item("PVTI_site1", "I_site#1", dated("2026-05-25", "2026-06-03")),
      item("PVTI_hidden", "I_site#2", dated("2026-06-01", "2026-06-10")),
      item("PVTI_site3", "I_site#3", dated("2026-06-06", "2026-06-16")),
      item("PVTI_int1", "I_internal#1", dated("2026-05-28", "2026-06-04")),
      item("PVTI_draft", null, todo, "Idea: dark mode"),
    ]),
    // site#3 is a sub-issue of the hidden issue and is blocked by the unlinked one and by site#1.
    db.insert(ghIssueLinks).values({ issueNodeId: "I_site#3", parentNodeId: "I_site#2", blockedBy: ["I_internal#1", "I_site#1"], syncedAt: now }),
    db.insert(workspaceGithub).values({ workspaceId, installationId: 99, projectNodeId: "PVT_1", linkedAt: now }),
    db.insert(workspaceRepos).values({ workspaceId, repoNodeId: "R_site" }),
  ]);
}

async function expectNoSecrets(text: string) {
  for (const secret of SECRETS) expect(text, `leaked "${secret}"`).not.toContain(secret);
}

test("Read Only never receives a hidden task or one from an unlinked repo", async ({ browser }) => {
  const contexts: BrowserContext[] = [];
  const page = async () => {
    const ctx = await browser.newContext();
    contexts.push(ctx);
    return ctx.newPage();
  };

  // Owner creates a workspace and invites a Read Only client.
  const owner = await page();
  await signIn(owner, "tasks-owner@example.com");
  await owner.getByLabel("Account name").fill("Tasks Agency");
  await owner.getByLabel("First workspace").fill("Tasks Website");
  await owner.getByRole("button", { name: "Create" }).click();
  await expect(owner.getByRole("heading", { name: "Tasks Website" })).toBeVisible();
  const workspaceId = /\/w\/([^/?#]+)/.exec(owner.url())![1]!;
  await seedLinkedBoard(workspaceId);

  // The owner sets the hide label through the settings form (no GitHub needed for this one).
  await owner.goto(`/w/${workspaceId}/settings`);
  await owner.getByLabel("Hide issues with this label").fill("internal");
  const saved = owner.waitForResponse((r) => r.url().endsWith(`/workspaces/${workspaceId}/settings`) && r.status() === 204);
  await owner.getByRole("button", { name: "Save", exact: true }).click();
  await saved;

  await owner.getByRole("link", { name: "Members" }).click();
  await owner.getByLabel("Email").fill("tasks-reader@example.com");
  await owner.getByLabel("Role").selectOption("read_only");
  await owner.getByRole("button", { name: "Send invite" }).click();
  const [, invitePath] = await lastEmail("tasks-reader@example.com", /http:\/\/localhost:\d+(\/invite\/[A-Za-z0-9_-]+)/);

  const reader = await page();
  await signIn(reader, "tasks-reader@example.com");
  await reader.goto(invitePath!);
  await reader.getByRole("button", { name: "Accept invite" }).click();
  await expect(reader.getByText("Your role: Read Only")).toBeVisible();

  // Positive control: the owner sees the hidden task and the draft, never the unlinked repo.
  await owner.goto(`/w/${workspaceId}?view=list`);
  await expect(owner.getByTestId("task-row")).toHaveCount(4);
  await expect(owner.getByText("Internal pricing notes")).toBeVisible();
  await expect(owner.getByText("Secret roadmap")).toHaveCount(0);

  // API: exactly the two visible tasks; links stripped of anything hidden.
  const res = await reader.request.get(`/api/v1/workspaces/${workspaceId}/tasks`);
  expect(res.status()).toBe(200);
  const body = await res.text();
  await expectNoSecrets(body);
  const { tasks } = JSON.parse(body) as { tasks: { id: string; parentId: string | null; blockedBy: string[] }[] };
  expect(tasks.map((t) => t.id).sort()).toEqual(["PVTI_site1", "PVTI_site3"]);
  expect(tasks.find((t) => t.id === "PVTI_site3")).toMatchObject({ parentId: null, blockedBy: ["PVTI_site1"] });
  for (const id of ["PVTI_hidden", "PVTI_int1", "PVTI_draft"]) {
    expect((await reader.request.get(`/api/v1/workspaces/${workspaceId}/tasks/${id}`)).status()).toBe(404);
  }

  // Every view, and the task pages.
  for (const view of ["list", "board", "timeline"]) {
    await reader.goto(`/w/${workspaceId}?view=${view}`);
    await expect(reader.getByText("Homepage hero").first()).toBeVisible();
    await expectNoSecrets(await reader.content());
  }
  await reader.goto(`/w/${workspaceId}?view=board`);
  await expect(reader.getByTestId("task-card")).toHaveCount(2);
  await reader.goto(`/w/${workspaceId}?view=timeline`);
  await expect(reader.getByTestId("timeline-row")).toHaveCount(2);
  await reader.goto(`/w/${workspaceId}/tasks/PVTI_site3`);
  await expect(reader.getByRole("heading", { name: "Pricing table" })).toBeVisible();
  await expectNoSecrets(await reader.content());
  for (const id of ["PVTI_hidden", "PVTI_int1"]) {
    const r = await reader.goto(`/w/${workspaceId}/tasks/${id}`);
    expect(r?.status()).toBe(404);
  }

  // Read Only cannot write.
  await reader.goto(`/w/${workspaceId}`);
  await expect(reader.getByRole("button", { name: "New task" })).toHaveCount(0);
  const write = await reader.request.patch(`/api/v1/workspaces/${workspaceId}/tasks/PVTI_site1`, {
    data: { title: "x" },
    headers: { origin: new URL(reader.url()).origin },
  });
  expect(write.status()).toBe(403);

  for (const ctx of contexts) await ctx.close();
});
