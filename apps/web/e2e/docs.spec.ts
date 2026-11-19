/**
 * Phase 4 (docs/spec.md): the doc tree and the editor in a real browser.
 *
 * GitHub is not reachable in E2E, so the test writes the cache rows a synced docs folder would
 * have, and checks what a page can do from the cache: the tree, the hide folder for Read Only, the
 * rich-text view, formatting, the frontmatter panel, and that single-key shortcuts stay out of the
 * editor. Commits are covered against a fake GitHub in packages/server/test/docs.test.ts.
 */
import { type BrowserContext, type Page, expect, test } from "@playwright/test";
import { ghDocBlobs, ghDocFiles, ghDocRoots, ghProjects, ghRepos, workspaceGithub, workspaceRepos } from "@gitwork/db";
import { openSqlite } from "@gitwork/db/node";
import { lastEmail, signInCode } from "./outbox";

const README = "---\ntitle: Welcome\ntags: [a, b]\n---\n# Handbook\n\nSome **bold** words.\n\n- [ ] Write docs\n";
const SECRET = "# Secret plan\n\nInternal only.\n";

async function signIn(page: Page, email: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Email me a sign-in code" }).click();
  await page.getByLabel("Code").fill(await signInCode(email));
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}

async function seedDocs(workspaceId: string) {
  const { db } = openSqlite("file:.data/e2e.sqlite");
  const now = new Date();
  // The whole repo (decision 038): root "" and the repo's own folders.
  const root = "R_docs:main:";
  await db.batch([
    db
      .insert(ghRepos)
      .values({ nodeId: "R_docs", githubId: 50, installationId: 99, owner: "acme", name: "handbook", fullName: "acme/handbook", private: true, defaultBranch: "main", htmlUrl: "https://github.com/acme/handbook", syncedAt: now })
      .onConflictDoNothing(),
    db.insert(ghProjects).values({ nodeId: "PVT_docs", installationId: 99, ownerLogin: "acme", number: 7, title: "Handbook", url: "https://github.com/orgs/acme/projects/7", syncedAt: now }).onConflictDoNothing(),
    db.insert(workspaceGithub).values({ workspaceId, installationId: 99, projectNodeId: "PVT_docs", linkedAt: now }),
    db.insert(workspaceRepos).values({ workspaceId, repoNodeId: "R_docs", docsPath: "" }),
    db.insert(ghDocRoots).values({ id: root, repoNodeId: "R_docs", branch: "main", path: "", headOid: "c0ffee", treeOid: "7ree", syncedAt: now }),
    db.insert(ghDocFiles).values([
      { rootId: root, path: "README.md", blobSha: "a".repeat(40), size: README.length },
      { rootId: root, path: "docs/internal/plan.md", blobSha: "b".repeat(40), size: SECRET.length },
      { rootId: root, path: "docs/guide/setup.md", blobSha: "c".repeat(40), size: 9 },
    ]),
    db.insert(ghDocBlobs).values([
      { sha: "a".repeat(40), text: README, size: README.length, fetchedAt: now },
      { sha: "b".repeat(40), text: SECRET, size: SECRET.length, fetchedAt: now },
      { sha: "c".repeat(40), text: "# Setup\n", size: 9, fetchedAt: now },
    ]),
  ]);
}

test("docs: tree, hide folder, rich-text editor, frontmatter panel", async ({ browser }) => {
  const contexts: BrowserContext[] = [];
  const page = async () => {
    const ctx = await browser.newContext();
    contexts.push(ctx);
    return ctx.newPage();
  };

  const owner = await page();
  await signIn(owner, "docs-owner@example.com");
  await owner.getByLabel("Account name").fill("Docs Agency");
  await owner.getByLabel("First workspace").fill("Docs Website");
  await owner.getByRole("button", { name: "Create" }).click();
  await expect(owner.getByRole("heading", { name: "Docs Website" })).toBeVisible();
  const workspaceId = /\/w\/([^/?#]+)/.exec(owner.url())![1]!;
  await seedDocs(workspaceId);

  // The hide folder, set through the settings form.
  await owner.goto(`/w/${workspaceId}/settings`);
  await owner.getByLabel("Hide docs in this folder").fill("docs/internal");
  const saved = owner.waitForResponse((r) => r.url().endsWith(`/workspaces/${workspaceId}/settings`) && r.status() === 204);
  await owner.getByRole("button", { name: "Save", exact: true }).click();
  await saved;

  // A Read Only client.
  await owner.getByRole("link", { name: "Members" }).click();
  await owner.getByLabel("Email").fill("docs-reader@example.com");
  await owner.getByLabel("Role").selectOption("read_only");
  await owner.getByRole("button", { name: "Send invite" }).click();
  const [, invitePath] = await lastEmail("docs-reader@example.com", /http:\/\/localhost:\d+(\/invite\/[A-Za-z0-9_-]+)/);
  const reader = await page();
  await signIn(reader, "docs-reader@example.com");
  await reader.goto(invitePath!);
  await reader.getByRole("button", { name: "Accept invite" }).click();
  await expect(reader.getByText("Your role: Read Only")).toBeVisible();

  // Owner: the whole tree, from the sidebar's Docs link.
  await owner.goto(`/w/${workspaceId}`);
  await owner.getByRole("link", { name: "Docs", exact: true }).click();
  // The repo is the top folder, with the repo's own folders inside.
  const tree = owner.getByRole("complementary", { name: "Docs" });
  await expect(tree.getByRole("button", { name: "handbook" })).toBeVisible();
  await expect(tree.getByRole("link", { name: "README" })).toBeVisible();
  await expect(tree.getByRole("button", { name: "docs" })).toBeVisible();
  await expect(tree.getByRole("button", { name: "internal" })).toBeVisible();
  await expect(tree.getByRole("button", { name: "guide" })).toBeVisible();

  // Read Only: no hidden folder in the tree, the API, or by URL.
  await reader.goto(`/w/${workspaceId}/docs`);
  await expect(reader.getByRole("complementary", { name: "Docs" }).getByRole("link", { name: "README" })).toBeVisible();
  expect(await reader.content()).not.toContain("internal");
  const list = await (await reader.request.get(`/api/v1/workspaces/${workspaceId}/docs`)).text();
  expect(list).not.toContain("internal");
  expect((await reader.request.get(`/api/v1/workspaces/${workspaceId}/docs/file?repo=R_docs&path=docs/internal/plan.md`)).status()).toBe(404);
  const r = await reader.request.get(`/api/v1/workspaces/${workspaceId}/docs/file?repo=R_docs&path=README.md`);
  expect(await r.json()).toMatchObject({ doc: { text: README, editable: false } });

  // Read Only sees the doc rendered, with no toolbar or save.
  await reader.getByRole("complementary", { name: "Docs" }).getByRole("link", { name: "README" }).click();
  await expect(reader.locator(".cm-lp-h1")).toHaveText("Handbook");
  await expect(reader.getByRole("toolbar", { name: "Formatting" })).toHaveCount(0);
  await expect(reader.getByRole("button", { name: "Save" })).toHaveCount(0);

  // Owner: the rich-text view hides marks; the cursor's line shows the source.
  await owner.getByRole("complementary", { name: "Docs" }).getByRole("link", { name: "README" }).click();
  const editor = owner.getByTestId("doc-editor");
  await expect(editor.locator(".cm-lp-h1")).toHaveText("Handbook");
  await expect(editor.locator(".cm-lp-strong")).toHaveText("bold");
  await expect(editor.locator("input.cm-lp-task")).toHaveCount(1);
  // Frontmatter lives in the properties panel; the parser would draw it as a rule and a heading.
  await expect(editor.getByText("title: Welcome")).toHaveCount(0);
  await expect(editor.locator("hr")).toHaveCount(0);
  await editor.locator(".cm-lp-h1").click();
  await expect(editor.locator(".cm-lp-h1")).toHaveText("# Handbook");

  // Single-key shortcuts never fire inside the editor (roadmap C4): "c" types a "c".
  await owner.keyboard.press("End");
  await owner.keyboard.type(" c");
  await expect(editor.locator(".cm-lp-h1")).toHaveText("# Handbook c");
  await expect(owner.getByRole("dialog")).toHaveCount(0);
  await expect(owner.getByTestId("doc-status")).toHaveText("Unsaved changes");

  // Formatting: select a word and make it italic.
  await editor.locator(".cm-line", { hasText: "Some" }).click();
  await owner.keyboard.press("Home");
  for (let i = 0; i < 4; i++) await owner.keyboard.press("Shift+ArrowRight");
  await owner.getByRole("button", { name: "Italic (⌘I)" }).click();
  await owner.getByRole("group", { name: "View" }).getByRole("button", { name: "Markdown" }).click();
  await expect(editor.locator(".cm-line", { hasText: "bold" })).toHaveText("*Some* **bold** words.");

  // The frontmatter panel edits one line; the list stays read-only.
  const panel = owner.getByRole("region", { name: "Properties" });
  await expect(panel.getByText("[a, b]")).toBeVisible();
  await panel.getByLabel("Property title").fill("Welcome aboard");
  await panel.getByLabel("Property title").press("Enter");
  await expect(editor.locator(".cm-line").nth(1)).toHaveText("title: Welcome aboard");
  await expect(editor.locator(".cm-line").nth(2)).toHaveText("tags: [a, b]");

  // A save needs GitHub; without the App the editor says so and keeps the text.
  await owner.getByRole("button", { name: "Save", exact: true }).click();
  await expect(owner.getByTestId("doc-status")).toContainText("GitHub App is not set up");
  await expect(editor.locator(".cm-line").nth(1)).toHaveText("title: Welcome aboard");

  for (const ctx of contexts) await ctx.close();
});
