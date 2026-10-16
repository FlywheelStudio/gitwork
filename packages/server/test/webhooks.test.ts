import { type Database, ghIssueLinks, ghIssues, ghProjectItems, ghRepos, ghSyncTargets, githubInstallationTokens, githubInstallations, githubWebhookDeliveries } from "@gitwork/db";
import { type TestDriver, allTestDrivers } from "@gitwork/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { handleGitHubWebhook } from "../src/github/webhooks";
import { item } from "./fake-github";
import { APP, INSTALLATION, REPO, githubContext, webhookRequest } from "./github-helpers";

const drivers = await allTestDrivers();
afterAll(() => Promise.all(drivers.map((d) => d.dispose())));

function issuePayload(action: string, issue: { number: number; title?: string; updated_at: string; state?: string }) {
  return {
    action,
    installation: { id: INSTALLATION.id },
    repository: REPO,
    issue: {
      node_id: `I_${issue.number}`,
      number: issue.number,
      title: issue.title ?? "Title",
      body: "Body",
      state: issue.state ?? "open",
      labels: [{ name: "bug", color: "d73a4a" }],
      assignees: [],
      user: { login: "octo" },
      html_url: `https://github.com/acme/site/issues/${issue.number}`,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: issue.updated_at,
    },
  };
}

describe.each(drivers)("GitHub webhooks on $name", (driver: TestDriver) => {
  let database: Database;
  let ctx: Awaited<ReturnType<typeof githubContext>>;
  const deliver = (event: string, payload: unknown, opts?: { deliveryId?: string; secret?: string }) =>
    handleGitHubWebhook(webhookRequest(event, payload, opts), { db: ctx.db, app: APP, client: ctx.client });
  const issue = async (nodeId: string) => (await ctx.db.select().from(ghIssues).where(eq(ghIssues.nodeId, nodeId)))[0];

  beforeEach(async () => {
    database = await driver.fresh();
    ctx = await githubContext(database);
  });

  it("rejects a bad signature and records nothing", async () => {
    const res = await deliver("issues", issuePayload("opened", { number: 1, updated_at: "2026-02-01T10:00:00Z" }), { secret: "wrong" });
    expect(res.status).toBe(401);
    expect(await ctx.db.select().from(githubWebhookDeliveries)).toHaveLength(0);
    expect(await issue("I_1")).toBeUndefined();
  });

  it("applies an issue event, and a replay of the same delivery changes nothing", async () => {
    const opened = issuePayload("opened", { number: 1, title: "First", updated_at: "2026-02-01T10:00:00Z" });
    expect(await (await deliver("issues", opened, { deliveryId: "d-1" })).json()).toMatchObject({ status: "processed" });
    expect((await issue("I_1"))?.title).toBe("First");

    const tampered = issuePayload("edited", { number: 1, title: "Replayed", updated_at: "2026-02-01T11:00:00Z" });
    expect(await (await deliver("issues", tampered, { deliveryId: "d-1" })).json()).toMatchObject({ status: "duplicate" });
    expect((await issue("I_1"))?.title).toBe("First");
  });

  it("never lets an older event overwrite a newer row", async () => {
    await deliver("issues", issuePayload("edited", { number: 1, title: "Newer", updated_at: "2026-02-01T12:00:00Z" }));
    await deliver("issues", issuePayload("edited", { number: 1, title: "Older", updated_at: "2026-02-01T11:00:00Z" }));
    expect((await issue("I_1"))?.title).toBe("Newer");
  });

  it("fetches the issue from GitHub when timestamps tie", async () => {
    ctx.fake.addRepo("acme/site", REPO.node_id, REPO.id);
    await deliver("issues", issuePayload("edited", { number: 1, title: "A", updated_at: "2026-02-01T12:00:00Z" }));
    ctx.fake.putIssue("acme/site", { number: 1, node_id: "I_1", title: "Current on GitHub", updated_at: "2026-02-01T12:00:00Z" });
    await deliver("issues", issuePayload("edited", { number: 1, title: "B", updated_at: "2026-02-01T12:00:00Z" }));
    expect((await issue("I_1"))?.title).toBe("Current on GitHub");
  });

  it("tombstones a deleted issue, and later events never bring it back", async () => {
    await deliver("issues", issuePayload("opened", { number: 1, updated_at: "2026-02-01T10:00:00Z" }));
    await deliver("issues", issuePayload("deleted", { number: 1, updated_at: "2026-02-01T10:00:00Z" }));
    expect((await issue("I_1"))?.deleted).toBe(true);
    await deliver("issues", issuePayload("edited", { number: 1, title: "Zombie", updated_at: "2099-01-01T00:00:00Z" }));
    expect(await issue("I_1")).toMatchObject({ deleted: true });
  });

  it("ignores pull requests in issue events", async () => {
    const payload = issuePayload("opened", { number: 2, updated_at: "2026-02-01T10:00:00Z" });
    (payload.issue as Record<string, unknown>).pull_request = { url: "x" };
    await deliver("issues", payload);
    expect(await issue("I_2")).toBeUndefined();
  });

  it("records nothing when processing fails, so a redelivery still works", async () => {
    ctx.fake.addRepo("acme/site", REPO.node_id, REPO.id);
    await deliver("issues", issuePayload("edited", { number: 1, title: "A", updated_at: "2026-02-01T12:00:00Z" }));
    ctx.fake.putIssue("acme/site", { number: 1, node_id: "I_1", title: "Fixed", updated_at: "2026-02-01T12:00:00Z" });
    // Tie → refetch → token request fails.
    ctx.fake.failNext = { status: 500 };
    const tie = issuePayload("edited", { number: 1, title: "B", updated_at: "2026-02-01T12:00:00Z" });
    await expect(deliver("issues", tie, { deliveryId: "d-fail" })).rejects.toThrow();
    expect(await ctx.db.select().from(githubWebhookDeliveries).where(eq(githubWebhookDeliveries.deliveryId, "d-fail"))).toHaveLength(0);
    expect(await (await deliver("issues", tie, { deliveryId: "d-fail" })).json()).toMatchObject({ status: "processed" });
    expect((await issue("I_1"))?.title).toBe("Fixed");
  });

  describe("installations", () => {
    it("records an installation and its repos, and hides repos when access is removed", async () => {
      await deliver("installation", { action: "created", installation: INSTALLATION, repositories: [REPO] });
      expect(await ctx.db.select().from(githubInstallations)).toHaveLength(1);
      expect((await ctx.db.select().from(ghRepos))[0]).toMatchObject({ fullName: "acme/site", available: true });

      await deliver("installation_repositories", {
        action: "removed",
        installation: INSTALLATION,
        repositories_added: [],
        repositories_removed: [REPO],
      });
      expect((await ctx.db.select().from(ghRepos))[0]?.available).toBe(false);
    });

    it("does not bring back a removed repo when the installation is unsuspended", async () => {
      const other = { ...REPO, node_id: "R_other", id: 502, name: "other", full_name: "acme/other" };
      await deliver("installation", { action: "created", installation: INSTALLATION, repositories: [REPO, other] });
      await deliver("installation_repositories", {
        action: "removed",
        installation: INSTALLATION,
        repositories_added: [],
        repositories_removed: [other],
      });
      await deliver("installation", { action: "suspend", installation: { ...INSTALLATION, suspended_at: "2026-02-01T00:00:00Z" } });
      await deliver("installation", { action: "unsuspend", installation: INSTALLATION });
      const rows = await ctx.db.select().from(ghRepos);
      expect(rows.find((r) => r.nodeId === "R_other")?.available).toBe(false);
    });

    it("hides everything and drops cached tokens when the installation is deleted", async () => {
      await deliver("installation", { action: "created", installation: INSTALLATION, repositories: [REPO] });
      await ctx.client.installationToken(INSTALLATION.id);
      expect(await ctx.db.select().from(githubInstallationTokens)).toHaveLength(1);
      await deliver("installation", { action: "deleted", installation: INSTALLATION });
      expect((await ctx.db.select().from(ghRepos))[0]?.available).toBe(false);
      expect(await ctx.db.select().from(githubInstallationTokens)).toHaveLength(0);
      expect((await ctx.db.select().from(githubInstallations))[0]?.deletedAt).toBeInstanceOf(Date);
    });
  });

  describe("project items", () => {
    const itemEvent = (action: string, nodeId: string, projectNodeId = "PVT_board") => ({
      action,
      installation: { id: INSTALLATION.id },
      organization: { login: "acme" },
      projects_v2_item: { node_id: nodeId, project_node_id: projectNodeId, content_type: "Issue", updated_at: "2026-02-01T10:00:00Z" },
    });

    beforeEach(async () => {
      await ctx.db.insert(ghSyncTargets).values({ kind: "project", nodeId: "PVT_board", installationId: INSTALLATION.id, locator: "acme#1" });
      ctx.fake.projects.set("PVT_board", { id: "PVT_board", number: 1, title: "Board", owner: "acme", fields: [], items: [item("PVTI_1", "2026-02-01T10:00:00Z", { status: "In progress" })] });
    });

    it("fetches the changed item and stores its field values", async () => {
      await deliver("projects_v2_item", itemEvent("edited", "PVTI_1"));
      const [row] = await ctx.db.select().from(ghProjectItems);
      expect(row?.fieldValues).toEqual({ F_status: { type: "single_select", optionId: "opt-In progress", name: "In progress" } });
    });

    it("ignores boards that are not sync targets", async () => {
      await deliver("projects_v2_item", itemEvent("edited", "PVTI_x", "PVT_other"));
      expect(await ctx.db.select().from(ghProjectItems)).toHaveLength(0);
      expect(ctx.fake.requests.filter((r) => r.includes("graphql"))).toHaveLength(0);
    });

    it("tombstones a deleted item", async () => {
      await deliver("projects_v2_item", itemEvent("edited", "PVTI_1"));
      await deliver("projects_v2_item", itemEvent("deleted", "PVTI_1"));
      expect((await ctx.db.select().from(ghProjectItems))[0]?.deleted).toBe(true);
    });
  });
  it("refetches links from GitHub on sub_issues and issue_dependencies events", async () => {
    ctx.fake.links.set("I_child", { parent: "I_parent", blockedBy: ["I_blocker"] });
    const res = await deliver("sub_issues", {
      action: "parent_issue_added",
      installation: { id: INSTALLATION.id },
      repository: REPO,
      // The payload's own claim is ignored; GitHub's current answer is stored.
      parent_issue: { node_id: "I_parent", number: 1 },
      sub_issue: { node_id: "I_child", number: 2 },
    });
    expect(await res.json()).toMatchObject({ status: "processed" });
    const rows = await ctx.db.select().from(ghIssueLinks);
    expect(rows.find((r) => r.issueNodeId === "I_child")).toMatchObject({ parentNodeId: "I_parent", blockedBy: ["I_blocker"] });
    expect(rows.find((r) => r.issueNodeId === "I_parent")).toMatchObject({ parentNodeId: null, blockedBy: [] });

    ctx.fake.links.set("I_child", { parent: "I_parent", blockedBy: [] });
    await deliver("issue_dependencies", {
      action: "blocked_by_removed",
      installation: { id: INSTALLATION.id },
      repository: REPO,
      blocked_issue: { node_id: "I_child", number: 2 },
      blocking_issue: { node_id: "I_blocker", number: 3 },
    });
    expect((await ctx.db.select().from(ghIssueLinks).where(eq(ghIssueLinks.issueNodeId, "I_child")))[0]?.blockedBy).toEqual([]);
  });
});
