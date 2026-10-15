import { ghIssues, ghSyncTargets, githubWebhookDeliveries, instanceSettings, rateLimits } from "@gitwork/db";
import { sqliteTestDriver } from "@gitwork/db/testing";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { prune, runScheduledReconcile } from "../src/sync";
import { FakeGitHub } from "./fake-github";
import { APP, INSTALLATION, REPO } from "./github-helpers";

const ENV = {
  BETTER_AUTH_SECRET: "secret",
  GITHUB_APP_ID: APP.appId,
  GITHUB_APP_PRIVATE_KEY: APP.privateKeyPem,
  GITHUB_WEBHOOK_SECRET: APP.webhookSecret,
  GITHUB_CLIENT_ID: APP.clientId,
  GITHUB_CLIENT_SECRET: APP.clientSecret,
};

describe("runScheduledReconcile", () => {
  it("records why it skipped", async () => {
    const database = await sqliteTestDriver().fresh();
    expect(await runScheduledReconcile(database, {}, "h")).toMatchObject({ status: "skipped", reason: "no_secret" });
    expect(await runScheduledReconcile(database, { BETTER_AUTH_SECRET: "s" }, "h")).toMatchObject({ status: "skipped", reason: "no_app" });
    const [row] = await database.db.select().from(instanceSettings).where(eq(instanceSettings.key, "reconcile_last_run"));
    expect(JSON.parse(row!.value)).toMatchObject({ status: "skipped", reason: "no_app" });
  });

  it("reconciles sync targets with the App from the environment", async () => {
    const database = await sqliteTestDriver().fresh();
    const fake = new FakeGitHub();
    fake.addRepo("acme/site", REPO.node_id, REPO.id);
    fake.putIssue("acme/site", { number: 1, title: "Synced", updated_at: "2026-03-01T10:00:00Z" });
    await database.db.insert(ghSyncTargets).values({ kind: "repo", nodeId: REPO.node_id, installationId: INSTALLATION.id, locator: "acme/site" });
    const run = await runScheduledReconcile(database, ENV, "h", fake.fetch);
    expect(run).toMatchObject({ status: "done", synced: 1, failed: 0 });
    expect((await database.db.select().from(ghIssues))[0]?.title).toBe("Synced");
  });

  it("stores errors instead of throwing", async () => {
    const database = await sqliteTestDriver().fresh();
    const run = await runScheduledReconcile(database, { ...ENV, GITHUB_APP_PRIVATE_KEY: "not a key" }, "h", new FakeGitHub().fetch);
    // No targets yet, so the bad key is never used; add one to force a GitHub call.
    expect(run.status).toBe("done");
    await database.db.insert(ghSyncTargets).values({ kind: "repo", nodeId: REPO.node_id, installationId: 1, locator: "acme/site" });
    const failed = await runScheduledReconcile(database, { ...ENV, GITHUB_APP_PRIVATE_KEY: "not a key" }, "h", new FakeGitHub().fetch);
    expect(failed).toMatchObject({ status: "done", failed: 1 });
  });
});

describe("prune", () => {
  it("drops old deliveries and rate-limit rows, keeps recent ones", async () => {
    const database = await sqliteTestDriver().fresh();
    const now = Date.now();
    await database.db.insert(githubWebhookDeliveries).values([
      { deliveryId: "old", event: "ping", receivedAt: new Date(now - 15 * 86_400_000) },
      { deliveryId: "new", event: "ping", receivedAt: new Date(now - 86_400_000) },
    ]);
    await database.db.insert(rateLimits).values([
      { id: "1", key: "old", count: 1, lastRequest: now - 2 * 86_400_000 },
      { id: "2", key: "new", count: 1, lastRequest: now },
    ]);
    await prune(database, now);
    expect((await database.db.select().from(githubWebhookDeliveries)).map((d) => d.deliveryId)).toEqual(["new"]);
    expect((await database.db.select().from(rateLimits)).map((r) => r.key)).toEqual(["new"]);
  });
});
