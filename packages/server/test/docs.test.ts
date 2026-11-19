import { type Database, auditLog, docPendingPrs, ghDocBlobs, ghDocFiles, ghDocRoots } from "@gitwork/db";
import { type TestDriver, allTestDrivers } from "@gitwork/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ServiceError } from "../src/errors";
import { handleGitHubWebhook } from "../src/github/webhooks";
import { reconcile } from "../src/github/reconcile";
import {
  createDoc,
  deleteDoc,
  getDoc,
  heartbeat,
  listDocs,
  rawDocFile,
  renameDoc,
  saveDoc,
  setDocsConfig,
} from "../src/services/docs";
import { linkWorkspace } from "../src/services/link";
import { updateWorkspaceSettings } from "../src/services/workspace-settings";
import { blobSha } from "./fake-github";
import { APP, webhookRequest } from "./github-helpers";
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
  return error as ServiceError;
}

const SITE = "acme/site";
const CRLF = "# Setup\r\n\r\nStep one\r\nStep two\r\n";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
const bytes = (s: string) => new TextEncoder().encode(s);

describe.each(drivers)("docs on $name", (driver: TestDriver) => {
  let database: Database;
  let w: Awaited<ReturnType<typeof setupWorkspace>>;
  const writer = (userId: string) => {
    const people: Record<string, { name: string; email: string }> = {
      jane: { name: "Jane Admin", email: "jane@example.com" },
      max: { name: "Max Member", email: "max@example.com" },
      sam: { name: "Sam Member", email: "sam@example.com" },
      rita: { name: "Rita Reader", email: "rita@example.com" },
    };
    return { ...w.deps, author: people[userId]! };
  };
  const paths = async (userId: string) => (await listDocs(w.db, await w.access(userId))).repos.flatMap((r) => r.files.map((f) => f.path));
  const doc = async (userId: string, path: string) => getDoc(w.deps, await w.access(userId), IDS.site, path);
  const webhook = (event: string, payload: unknown) => handleGitHubWebhook(webhookRequest(event, payload), { db: w.db, app: APP, client: w.client });

  beforeEach(async () => {
    database = await driver.fresh();
    w = await setupWorkspace(database);
    w.fake.commit(SITE, "main", {
      "README.md": "# Site\n",
      "docs/README.md": "# Docs\n\nHello.\n",
      "docs/guide/setup.md": CRLF,
      "docs/internal/plan.md": "# Secret plan\n",
      "docs/internal/chart.png": PNG,
      "docs/assets/logo.png": PNG,
      "docs/assets/x.svg": SVG,
      "docs/bad.md": new Uint8Array([0x23, 0x20, 0xff, 0x0a]),
    });
    await linkWorkspace(w.deps, await w.access("jane"), { installationId: 99, projectNodeId: IDS.board, repoNodeIds: [IDS.site] });
    await updateWorkspaceSettings(w.db, await w.access("owner"), { hideFolder: "Internal" });
    w.fake.writes = [];
  });

  describe("reads", () => {
    it("syncs the docs folder when the workspace links the repo", async () => {
      const [repo] = (await listDocs(w.db, await w.access("max"))).repos;
      expect(repo).toMatchObject({ fullName: SITE, root: "docs", branch: "main", status: "ok" });
      expect(repo!.files.find((f) => f.path === "docs/assets/logo.png")?.kind).toBe("image");
      expect(repo!.files.find((f) => f.path === "docs/README.md")?.kind).toBe("doc");
    });

    it("shows Members the hide folder and hides it from Read Only; never files outside the docs folder", async () => {
      expect(await paths("max")).toContain("docs/internal/plan.md");
      const reader = await paths("rita");
      expect(reader.some((p) => p.includes("internal"))).toBe(false);
      expect(reader).toContain("docs/README.md");
      for (const user of ["owner", "max", "rita"]) expect(await paths(user)).not.toContain("README.md");
    });

    it("returns the exact text, CRLF and all", async () => {
      const d = await doc("max", "docs/guide/setup.md");
      expect(d.text).toBe(CRLF);
      expect(d.sha).toBe(blobSha(bytes(CRLF)));
      expect(d).toMatchObject({ name: "guide/setup.md", editable: true, canDelete: false, pending: null });
    });

    it("opens invalid UTF-8 read-only", async () => {
      expect(await doc("max", "docs/bad.md")).toMatchObject({ text: null, editable: false });
    });

    it("answers 404 for hidden, outside, traversal, and non-markdown paths", async () => {
      await rejects(doc("rita", "docs/internal/plan.md"), 404);
      await rejects(doc("rita", "docs/INTERNAL/plan.md"), 404);
      await rejects(doc("max", "README.md"), 404);
      await rejects(doc("max", "docs/../README.md"), 404);
      await rejects(doc("max", "docs/assets/logo.png"), 404);
      await rejects(getDoc(w.deps, await w.access("max"), IDS.internal, "docs/README.md"), 404);
    });

    it("shows Read Only a doc as not editable", async () => {
      expect(await doc("rita", "docs/README.md")).toMatchObject({ editable: false, canDelete: false });
    });

    it("serves images with a sandbox policy, and hides hidden files from Read Only", async () => {
      const res = await rawDocFile(w.deps, await w.access("rita"), IDS.site, "docs/assets/logo.png");
      expect(res.headers.get("content-type")).toBe("image/png");
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
      const svg = await rawDocFile(w.deps, await w.access("rita"), IDS.site, "docs/assets/x.svg");
      expect(svg.headers.get("content-security-policy")).toContain("sandbox");
      expect(svg.headers.get("x-content-type-options")).toBe("nosniff");
      await rejects(rawDocFile(w.deps, await w.access("rita"), IDS.site, "docs/internal/chart.png"), 404);
      expect((await rawDocFile(w.deps, await w.access("max"), IDS.site, "docs/internal/chart.png")).status).toBe(200);
    });
  });

  describe("saves", () => {
    it("commits as the user when their GitHub account can write, byte for byte", async () => {
      const d = await doc("jane", "docs/guide/setup.md");
      const text = d.text!.replace("two", "2");
      const out = await saveDoc(writer("jane"), await w.access("jane"), { repoNodeId: IDS.site, path: d.path, baseSha: d.sha, text });
      expect(out.status).toBe("committed");
      expect(w.fake.fileText(SITE, "main", "docs/guide/setup.md")).toBe("# Setup\r\n\r\nStep one\r\nStep 2\r\n");
      expect(w.fake.writes).toEqual(["user:jane createCommitOnBranch main"]);
      expect(w.fake.headMessage(SITE, "main")).toBe("Update guide/setup.md");
      // The cache holds the new version without waiting for a webhook.
      expect((await doc("max", d.path)).text).toBe(text);
      const [entry] = await w.db.select().from(auditLog).where(eq(auditLog.action, "doc.save"));
      expect(entry).toMatchObject({ userId: "jane", via: "user", target: d.path, commitSha: out.status === "committed" ? out.commitSha : "" });
    });

    it("commits through the App with a Co-authored-by trailer for people without GitHub", async () => {
      const d = await doc("max", "docs/README.md");
      await saveDoc(writer("max"), await w.access("max"), { repoNodeId: IDS.site, path: d.path, baseSha: d.sha, text: `${d.text}More.\n` });
      expect(w.fake.writes).toEqual(["app createCommitOnBranch main"]);
      expect(w.fake.headMessage(SITE, "main")).toContain("Co-authored-by: Max Member <max@example.com>");
    });

    it("falls back to the App when the user's own token is refused", async () => {
      const d = await doc("sam", "docs/README.md");
      await saveDoc(writer("sam"), await w.access("sam"), { repoNodeId: IDS.site, path: d.path, baseSha: d.sha, text: "# Docs\n" });
      expect(w.fake.writes).toEqual(["app createCommitOnBranch main"]);
    });

    it("makes no commit when nothing changed", async () => {
      const d = await doc("max", "docs/guide/setup.md");
      const out = await saveDoc(writer("max"), await w.access("max"), { repoNodeId: IDS.site, path: d.path, baseSha: d.sha, text: d.text! });
      expect(out).toEqual({ status: "unchanged", sha: d.sha });
      expect(w.fake.writes).toEqual([]);
    });

    it("refuses with the current text when GitHub changed since the doc was opened", async () => {
      const d = await doc("max", "docs/README.md");
      w.fake.commit(SITE, "main", { "docs/README.md": "# Docs\n\nTheirs.\n" });
      const error = await rejects(
        saveDoc(writer("max"), await w.access("max"), { repoNodeId: IDS.site, path: d.path, baseSha: d.sha, text: "# Docs\n\nMine.\n" }),
        409,
        "doc_conflict",
      );
      expect(error.data).toMatchObject({ current: { text: "# Docs\n\nTheirs.\n", sha: blobSha(bytes("# Docs\n\nTheirs.\n")) } });
      expect(w.fake.fileText(SITE, "main", "docs/README.md")).toBe("# Docs\n\nTheirs.\n");
    });

    it("commits on top of an unrelated commit made meanwhile", async () => {
      const d = await doc("max", "docs/README.md");
      w.fake.commit(SITE, "main", { "src/app.ts": "x" });
      const out = await saveDoc(writer("max"), await w.access("max"), { repoNodeId: IDS.site, path: d.path, baseSha: d.sha, text: "# New\n" });
      expect(out.status).toBe("committed");
      expect(w.fake.fileText(SITE, "main", "src/app.ts")).toBe("x");
    });

    it("refuses Read Only users", async () => {
      const d = await doc("rita", "docs/README.md");
      await rejects(saveDoc(writer("rita"), await w.access("rita"), { repoNodeId: IDS.site, path: d.path, baseSha: d.sha, text: "x" }), 403);
    });

    it("commits images in the same commit as the doc, inside the docs folder only", async () => {
      const d = await doc("max", "docs/README.md");
      const data = Buffer.from(PNG).toString("base64");
      const out = await saveDoc(writer("max"), await w.access("max"), {
        repoNodeId: IDS.site,
        path: d.path,
        baseSha: d.sha,
        text: `${d.text}![Shot](assets/shot.png)\n`,
        attachments: [{ path: "docs/assets/shot.png", data }],
      });
      expect(out.status).toBe("committed");
      expect(w.fake.writes).toEqual(["app createCommitOnBranch main"]);
      expect(await paths("max")).toContain("docs/assets/shot.png");
      const d2 = await doc("max", "docs/README.md");
      await rejects(
        saveDoc(writer("max"), await w.access("max"), { repoNodeId: IDS.site, path: d2.path, baseSha: d2.sha, text: "x", attachments: [{ path: "src/shot.png", data }] }),
        400,
      );
      await rejects(
        saveDoc(writer("max"), await w.access("max"), { repoNodeId: IDS.site, path: d2.path, baseSha: d2.sha, text: "x", attachments: [{ path: "docs/a.png", data: "A".repeat(14_000_000) }] }),
        400,
      );
      await rejects(
        saveDoc(writer("max"), await w.access("max"), { repoNodeId: IDS.site, path: d2.path, baseSha: d2.sha, text: "x", attachments: [{ path: "docs/assets/shot.png", data }] }),
        409,
        "doc_exists",
      );
    });
  });

  describe("pull request fallback", () => {
    it("opens a pull request when branch protection refuses the commit, then saves to its branch", async () => {
      w.fake.protectedBranches.add(`${SITE}#main`);
      const d = await doc("max", "docs/README.md");
      const out = await saveDoc(writer("max"), await w.access("max"), { repoNodeId: IDS.site, path: d.path, baseSha: d.sha, text: "# Reviewed\n" });
      expect(out.status).toBe("pending_review");
      if (out.status !== "pending_review") return;
      expect(w.fake.fileText(SITE, "main", "docs/README.md")).toBe("# Docs\n\nHello.\n");
      expect(w.fake.fileText(SITE, out.pr.branch, "docs/README.md")).toBe("# Reviewed\n");
      expect(w.fake.pulls).toHaveLength(1);
      expect(w.fake.pulls[0]).toMatchObject({ base: "main", head: out.pr.branch });
      expect(w.fake.pulls[0]!.body).toContain("branch protection");

      const files = (await listDocs(w.db, await w.access("max"))).repos[0]!.files;
      expect(files.find((f) => f.path === "docs/README.md")?.pending).toEqual({ number: out.pr.number, url: out.pr.url });
      // The editor now opens the PR branch's version, and the next save goes there.
      const pending = await doc("max", "docs/README.md");
      expect(pending).toMatchObject({ text: "# Reviewed\n", branch: out.pr.branch, canDelete: false });
      const again = await saveDoc(writer("max"), await w.access("max"), { repoNodeId: IDS.site, path: d.path, baseSha: pending.sha, text: "# Reviewed twice\n" });
      expect(again.status).toBe("pending_review");
      expect(w.fake.fileText(SITE, out.pr.branch, "docs/README.md")).toBe("# Reviewed twice\n");
      expect(w.fake.pulls).toHaveLength(1);

      // Closing the pull request ends "pending review".
      const res = await webhook("pull_request", { action: "closed", installation: { id: 99 }, repository: { node_id: IDS.site }, pull_request: { number: out.pr.number } });
      expect(res.status).toBe(200);
      expect(await w.db.select().from(docPendingPrs)).toEqual([]);
    });

    it("review mode sends App writes to a pull request, but not the user's own", async () => {
      await updateWorkspaceSettings(w.db, await w.access("owner"), { reviewBotDocEdits: true });
      const d = await doc("max", "docs/README.md");
      const out = await saveDoc(writer("max"), await w.access("max"), { repoNodeId: IDS.site, path: d.path, baseSha: d.sha, text: "# Max\n" });
      expect(out.status).toBe("pending_review");
      expect(w.fake.writes.some((x) => x.endsWith("createCommitOnBranch main"))).toBe(false);
      expect(w.fake.pulls[0]!.body).toContain("requires review");

      const g = await doc("jane", "docs/guide/setup.md");
      expect((await saveDoc(writer("jane"), await w.access("jane"), { repoNodeId: IDS.site, path: g.path, baseSha: g.sha, text: "# Jane\n" })).status).toBe("committed");
    });

    it("lists a new doc whose first save became a pull request", async () => {
      w.fake.protectedBranches.add(`${SITE}#main`);
      const out = await createDoc(writer("max"), await w.access("max"), { repoNodeId: IDS.site, path: "docs/new.md" });
      expect(out.status).toBe("pending_review");
      expect(await paths("max")).toContain("docs/new.md");
      expect((await doc("max", "docs/new.md")).text).toBe("# new\n");
    });
  });

  describe("create, rename, delete", () => {
    it("creates a doc and refuses an existing name or a path outside the folder", async () => {
      const out = await createDoc(writer("max"), await w.access("max"), { repoNodeId: IDS.site, path: "docs/guide/faq.md" });
      expect(out.status).toBe("committed");
      expect(w.fake.fileText(SITE, "main", "docs/guide/faq.md")).toBe("# faq\n");
      await rejects(createDoc(writer("max"), await w.access("max"), { repoNodeId: IDS.site, path: "docs/README.md" }), 409, "doc_exists");
      await rejects(createDoc(writer("max"), await w.access("max"), { repoNodeId: IDS.site, path: "src/x.md" }), 404);
      await rejects(createDoc(writer("max"), await w.access("max"), { repoNodeId: IDS.site, path: "docs/notes.txt" }), 400);
    });

    it("Read Only cannot write into the hide folder because it cannot see it", async () => {
      await rejects(createDoc(writer("rita"), await w.access("rita"), { repoNodeId: IDS.site, path: "docs/internal/x.md" }), 403);
    });

    it("renames in one commit", async () => {
      const d = await doc("max", "docs/guide/setup.md");
      const out = await renameDoc(writer("max"), await w.access("max"), { repoNodeId: IDS.site, path: d.path, baseSha: d.sha, newPath: "docs/guide/install.md" });
      expect(out.status).toBe("committed");
      expect(w.fake.writes).toEqual(["app createCommitOnBranch main"]);
      expect(w.fake.fileText(SITE, "main", "docs/guide/setup.md")).toBeNull();
      expect(w.fake.fileText(SITE, "main", "docs/guide/install.md")).toBe(CRLF);
      const list = await paths("max");
      expect(list).toContain("docs/guide/install.md");
      expect(list).not.toContain("docs/guide/setup.md");
      await rejects(renameDoc(writer("max"), await w.access("max"), { repoNodeId: IDS.site, path: "docs/README.md", baseSha: d.sha, newPath: "README.md" }), 400);
    });

    it("deletes for Admins only", async () => {
      const d = await doc("max", "docs/README.md");
      await rejects(deleteDoc(writer("max"), await w.access("max"), { repoNodeId: IDS.site, path: d.path, baseSha: d.sha }), 403);
      expect((await deleteDoc(writer("jane"), await w.access("jane"), { repoNodeId: IDS.site, path: d.path, baseSha: d.sha })).status).toBe("committed");
      expect(await paths("max")).not.toContain("docs/README.md");
      expect(w.fake.fileText(SITE, "main", "docs/README.md")).toBeNull();
    });
  });

  describe("sync", () => {
    it("picks up a push to the docs branch from the webhook", async () => {
      w.fake.commit(SITE, "main", { "docs/pushed.md": "# Pushed\n", "docs/README.md": null });
      const res = await webhook("push", { ref: "refs/heads/main", installation: { id: 99 }, repository: { node_id: IDS.site, full_name: SITE } });
      expect(res.status).toBe(200);
      const list = await paths("max");
      expect(list).toContain("docs/pushed.md");
      expect(list).not.toContain("docs/README.md");
    });

    it("ignores pushes to other branches, and skips the tree listing when the folder did not change", async () => {
      w.fake.commit(SITE, "feature", { "docs/branch.md": "x" });
      await webhook("push", { ref: "refs/heads/feature", installation: { id: 99 }, repository: { node_id: IDS.site } });
      expect(await paths("max")).not.toContain("docs/branch.md");
      w.fake.commit(SITE, "main", { "src/app.ts": "x" });
      w.fake.requests = [];
      await webhook("push", { ref: "refs/heads/main", installation: { id: 99 }, repository: { node_id: IDS.site } });
      expect(w.fake.requests.some((r) => r.includes("/git/trees/"))).toBe(false);
    });

    it("moves the docs folder and branch per repo, and prunes the old cache", async () => {
      w.fake.commit(SITE, "main", { "handbook/intro.md": "# Intro\n" });
      await rejects(setDocsConfig(w.deps, await w.access("max"), { repoNodeId: IDS.site, docsPath: "handbook" }), 403);
      await rejects(setDocsConfig(w.deps, await w.access("jane"), { repoNodeId: IDS.site, docsPath: "../x" }), 400);
      await rejects(setDocsConfig(w.deps, await w.access("jane"), { repoNodeId: IDS.site, docsBranch: "bad..name" }), 400);
      await setDocsConfig(w.deps, await w.access("jane"), { repoNodeId: IDS.site, docsPath: "/handbook/" });
      expect(await paths("max")).toEqual(["handbook/intro.md"]);
      const roots = await w.db.select().from(ghDocRoots);
      expect(roots.map((r) => r.path)).toEqual(["handbook"]);
      expect((await w.db.select().from(ghDocFiles)).every((f) => f.path.startsWith("handbook/"))).toBe(true);
      expect((await w.db.select().from(ghDocBlobs)).length).toBe(0);
    });

    it("reports a missing folder", async () => {
      await setDocsConfig(w.deps, await w.access("jane"), { repoNodeId: IDS.site, docsPath: "nowhere" });
      expect((await listDocs(w.db, await w.access("max"))).repos[0]!.status).toBe("missing");
    });

    it("reconcile repairs a missed push", async () => {
      w.fake.commit(SITE, "main", { "docs/missed.md": "# Missed\n" });
      await reconcile({ db: w.db, client: w.client, holder: "test", onlyNodeIds: [IDS.site] });
      expect(await paths("max")).toContain("docs/missed.md");
    });
  });

  describe("presence", () => {
    it("shows who else has the doc open, until the heartbeat expires", async () => {
      const t0 = new Date("2026-11-19T10:00:00Z");
      await heartbeat(w.db, await w.access("max"), IDS.site, "docs/README.md", t0);
      expect(await heartbeat(w.db, await w.access("jane"), IDS.site, "docs/README.md", t0)).toEqual([{ userId: "max", name: "Max Member" }]);
      expect(await heartbeat(w.db, await w.access("jane"), IDS.site, "docs/README.md", new Date(t0.getTime() + 60_000))).toEqual([]);
      await rejects(heartbeat(w.db, await w.access("rita"), IDS.site, "docs/README.md", t0), 403);
      await rejects(heartbeat(w.db, await w.access("max"), IDS.site, "README.md", t0), 404);
    });
  });

  describe("settings", () => {
    it("validates the hide folder", async () => {
      await rejects(updateWorkspaceSettings(w.db, await w.access("owner"), { hideFolder: "../x" }), 400);
      await rejects(updateWorkspaceSettings(w.db, await w.access("max"), { hideFolder: "x" }), 403);
      await updateWorkspaceSettings(w.db, await w.access("owner"), { hideFolder: "  " });
      expect(await paths("rita")).toContain("docs/internal/plan.md");
    });
  });
});
