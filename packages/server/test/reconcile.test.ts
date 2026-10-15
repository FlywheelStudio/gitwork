import { type Database, ghIssues, ghProjectItems, ghRepos, ghSyncTargets, syncLeases } from "@gitwork/db";
import { type TestDriver, allTestDrivers } from "@gitwork/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { reconcile } from "../src/github/reconcile";
import { handleGitHubWebhook } from "../src/github/webhooks";
import { item } from "./fake-github";
import { APP, INSTALLATION, REPO, githubContext, webhookRequest } from "./github-helpers";

const drivers = await allTestDrivers();
afterAll(() => Promise.all(drivers.map((d) => d.dispose())));

describe.each(drivers)("reconcile on $name", (driver: TestDriver) => {
  let database: Database;
  let ctx: Awaited<ReturnType<typeof githubContext>>;
  let clock: Date;
  const run = (opts: { maxPages?: number; holder?: string } = {}) =>
    reconcile({ db: ctx.db, client: ctx.client, holder: opts.holder ?? "test", now: () => clock, maxPages: opts.maxPages });
  const issues = () => ctx.db.select().from(ghIssues).where(eq(ghIssues.repoNodeId, REPO.node_id));
  const title = async (n: number) => (await issues()).find((i) => i.number === n)?.title;

  beforeEach(async () => {
    database = await driver.fresh();
    ctx = await githubContext(database);
    clock = new Date("2026-03-01T12:00:00Z");
    ctx.fake.addRepo("acme/site", REPO.node_id, REPO.id);
    await ctx.db.insert(ghSyncTargets).values({ kind: "repo", nodeId: REPO.node_id, installationId: INSTALLATION.id, locator: "acme/site" });
  });

  it("repairs a dropped webhook", async () => {
    ctx.fake.putIssue("acme/site", { number: 1, title: "v1", updated_at: "2026-03-01T10:00:00Z" });
    await run();
    expect(await title(1)).toBe("v1");

    // GitHub changes the issue; the webhook never arrives.
    ctx.fake.putIssue("acme/site", { number: 1, title: "v2", updated_at: "2026-03-01T12:05:00Z" });
    clock = new Date("2026-03-01T12:15:00Z");
    const result = await run();
    expect(result.synced).toEqual(["repo:acme/site"]);
    expect(await title(1)).toBe("v2");
  });

  it("asks only for changes since the last run, with a 2-minute overlap", async () => {
    await run();
    ctx.fake.requests.length = 0;
    clock = new Date("2026-03-01T12:15:00Z");
    await run();
    const list = ctx.fake.requests.find((r) => r.startsWith("GET /repos/acme/site/issues?"))!;
    expect(new URL(`https://x${list.slice(4)}`).searchParams.get("since")).toBe("2026-03-01T11:58:00.000Z");
  });

  it("skips pull requests", async () => {
    ctx.fake.putIssue("acme/site", { number: 3, updated_at: "2026-03-01T10:00:00Z", pull_request: { url: "x" } });
    await run();
    expect(await issues()).toHaveLength(0);
  });

  it("tombstones issues a full sweep no longer finds", async () => {
    ctx.fake.putIssue("acme/site", { number: 1, updated_at: "2026-03-01T10:00:00Z" });
    ctx.fake.putIssue("acme/site", { number: 2, updated_at: "2026-03-01T10:00:00Z" });
    await run();
    ctx.fake.issues.set("acme/site", ctx.fake.issues.get("acme/site")!.filter((i) => i.number !== 2));
    clock = new Date("2026-03-02T13:00:00Z"); // more than a day later → full sweep
    await run();
    const rows = await issues();
    expect(rows.find((i) => i.number === 2)?.deleted).toBe(true);
    expect(rows.find((i) => i.number === 1)?.deleted).toBe(false);
  });

  it("continues where it stopped when it runs out of pages", async () => {
    ctx.fake.pageSize = 2;
    for (let n = 1; n <= 5; n++) ctx.fake.putIssue("acme/site", { number: n, updated_at: `2026-03-01T10:0${n}:00Z` });
    await run({ maxPages: 1 }); // first run is a full sweep; it gets 2 of 5
    expect(await issues()).toHaveLength(2);
    const [target] = await ctx.db.select().from(ghSyncTargets);
    expect(target?.lastSyncedAt?.toISOString()).toBe("2026-03-01T10:02:00.000Z");
    expect(target?.lastFullSyncAt).toBeNull();
  });

  it("marks the repo unavailable when GitHub returns 404", async () => {
    await ctx.db.insert(ghRepos).values({
      nodeId: REPO.node_id, githubId: REPO.id, installationId: INSTALLATION.id, owner: "acme", name: "site",
      fullName: "acme/site", private: true, htmlUrl: "https://github.com/acme/site", syncedAt: clock,
    });
    ctx.fake.repos.delete("acme/site");
    await run();
    expect((await ctx.db.select().from(ghRepos))[0]?.available).toBe(false);
  });

  it("stops at a rate limit and reports it", async () => {
    ctx.fake.failNext = { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1900000000" } };
    const result = await run();
    expect(result.rateLimited).toBe(true);
    expect(result.synced).toEqual([]);
  });

  it("runs once at a time: a second run while the lease is held is skipped", async () => {
    await ctx.db.insert(syncLeases).values({ name: "reconcile", holder: "other", expiresAt: new Date(clock.getTime() + 60_000) });
    expect((await run()).skipped).toBe("lease_held");
    clock = new Date(clock.getTime() + 120_000); // lease expired
    expect((await run()).skipped).toBeUndefined();
  });

  it("does not undo a newer webhook with older reconcile data", async () => {
    ctx.fake.putIssue("acme/site", { number: 1, title: "From GitHub list", updated_at: "2026-03-01T10:00:00Z" });
    await handleGitHubWebhook(
      webhookRequest("issues", {
        action: "edited",
        installation: { id: INSTALLATION.id },
        repository: REPO,
        issue: { ...ctx.fake.issues.get("acme/site")![0], title: "From webhook", updated_at: "2026-03-01T11:00:00Z" },
      }),
      { db: ctx.db, app: APP, client: ctx.client },
    );
    await run();
    expect(await title(1)).toBe("From webhook");
  });

  describe("projects", () => {
    beforeEach(async () => {
      await ctx.db.delete(ghSyncTargets);
      await ctx.db.insert(ghSyncTargets).values({ kind: "project", nodeId: "PVT_board", installationId: INSTALLATION.id, locator: "acme#1" });
      ctx.fake.projects.set("PVT_board", {
        id: "PVT_board",
        number: 1,
        title: "Board",
        owner: "acme",
        fields: [{ id: "F_status", name: "Status", dataType: "SINGLE_SELECT", options: [{ id: "opt-Todo", name: "Todo" }] }],
        items: [
          item("PVTI_1", "2026-03-01T10:00:00Z", { status: "Todo" }),
          item("PVTI_2", "2026-03-01T10:00:00Z", { archived: true }),
          item("PVTI_3", "2026-03-01T10:00:00Z"),
        ],
      });
    });

    it("stores every item, archived ones included, across pages", async () => {
      ctx.fake.pageSize = 2;
      await run();
      const rows = await ctx.db.select().from(ghProjectItems);
      expect(rows.map((r) => [r.nodeId, r.archived]).sort()).toEqual([
        ["PVTI_1", false],
        ["PVTI_2", true],
        ["PVTI_3", false],
      ]);
    });

    it("tombstones items removed from the board", async () => {
      await run();
      ctx.fake.projects.get("PVT_board")!.items.pop();
      clock = new Date("2026-03-01T12:15:00Z");
      await run();
      const rows = await ctx.db.select().from(ghProjectItems);
      expect(rows.find((r) => r.nodeId === "PVTI_3")?.deleted).toBe(true);
      expect(rows.filter((r) => !r.deleted)).toHaveLength(2);
    });
  });
});

describe("installation tokens", () => {
  it("are shared through the database until shortly before they expire", async () => {
    const [driver] = drivers;
    const database = await driver!.fresh();
    const ctx = await githubContext(database);
    const { GitHubClient } = await import("../src/github/client");
    const second = new GitHubClient({ db: ctx.db, box: ctx.box, app: APP, fetch: ctx.fake.fetch });
    const a = await ctx.client.installationToken(1);
    const b = await second.installationToken(1);
    expect(a).toBe(b);
    expect(ctx.fake.tokensIssued).toBe(1);
    const late = new GitHubClient({ db: ctx.db, box: ctx.box, app: APP, fetch: ctx.fake.fetch, now: () => Date.now() + 56 * 60_000 });
    await late.installationToken(1);
    expect(ctx.fake.tokensIssued).toBe(2);
  });
});
