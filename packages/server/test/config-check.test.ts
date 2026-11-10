import { githubInstallations, githubWebhookDeliveries, instanceSettings } from "@gitwork/db";
import { allTestDrivers } from "@gitwork/db/testing";
import { afterAll, describe, expect, it } from "vitest";
import { checkConfig, instanceHealth } from "../src/config-check";

const GOOD_NODE = {
  BETTER_AUTH_SECRET: "a".repeat(44),
  BETTER_AUTH_URL: "https://gitwork.example",
  INSTANCE_ADMIN_EMAILS: "admin@example.com",
  EMAIL_TRANSPORT: "smtp",
  SMTP_URL: "smtp://user:pass@mail.example:587",
  EMAIL_FROM: "Gitwork <no-reply@gitwork.example>",
  DATABASE_URL: "file:/data/gitwork.sqlite",
};
const GOOD_WORKER = { ...GOOD_NODE, EMAIL_TRANSPORT: "cloudflare", SMTP_URL: undefined, DATABASE_URL: undefined };

const keys = (env: Record<string, string | undefined>, runtime: "node" | "workerd" = "node", level = "error") =>
  checkConfig(env, runtime)
    .filter((i) => i.level === level)
    .map((i) => i.key);

describe("checkConfig", () => {
  it("passes a complete Node configuration", () => {
    expect(checkConfig(GOOD_NODE, "node")).toEqual([]);
  });

  it("passes a complete Worker configuration", () => {
    expect(checkConfig(GOOD_WORKER, "workerd")).toEqual([]);
  });

  it("fails an empty configuration on every required variable", () => {
    expect(keys({})).toEqual(["BETTER_AUTH_SECRET", "BETTER_AUTH_URL", "INSTANCE_ADMIN_EMAILS", "EMAIL_TRANSPORT"]);
  });

  it("fails a short secret", () => {
    expect(keys({ ...GOOD_NODE, BETTER_AUTH_SECRET: "short" })).toEqual(["BETTER_AUTH_SECRET"]);
  });

  it("fails a URL that is not http(s), and warns on plain http for a public host", () => {
    expect(keys({ ...GOOD_NODE, BETTER_AUTH_URL: "ftp://x.example" })).toEqual(["BETTER_AUTH_URL"]);
    expect(keys({ ...GOOD_NODE, BETTER_AUTH_URL: "not a url" })).toEqual(["BETTER_AUTH_URL"]);
    expect(keys({ ...GOOD_NODE, BETTER_AUTH_URL: "http://gitwork.example" }, "node", "warn")).toEqual(["BETTER_AUTH_URL"]);
    expect(checkConfig({ ...GOOD_NODE, BETTER_AUTH_URL: "http://localhost:3000" }, "node")).toEqual([]);
  });

  it("fails smtp without SMTP_URL, console in production, and anything but cloudflare on Workers", () => {
    expect(keys({ ...GOOD_NODE, SMTP_URL: undefined })).toEqual(["SMTP_URL"]);
    expect(keys({ ...GOOD_NODE, EMAIL_TRANSPORT: "console" })).toEqual(["EMAIL_TRANSPORT"]);
    expect(keys({ ...GOOD_WORKER, EMAIL_TRANSPORT: "smtp" }, "workerd")).toEqual(["EMAIL_TRANSPORT"]);
    expect(keys({ ...GOOD_NODE, EMAIL_TRANSPORT: "outbox" }, "node", "warn")).toEqual(["EMAIL_TRANSPORT"]);
  });

  it("fails a partial set of GitHub App variables and names the missing ones", () => {
    const issues = checkConfig({ ...GOOD_NODE, GITHUB_APP_ID: "1", GITHUB_CLIENT_ID: "Iv1.x" }, "node");
    expect(issues).toEqual([
      expect.objectContaining({ level: "error", key: "GITHUB_APP_PRIVATE_KEY, GITHUB_WEBHOOK_SECRET, GITHUB_CLIENT_SECRET" }),
    ]);
  });

  it("accepts all five GitHub App variables", () => {
    const all = {
      GITHUB_APP_ID: "1",
      GITHUB_APP_PRIVATE_KEY: "k",
      GITHUB_WEBHOOK_SECRET: "w",
      GITHUB_CLIENT_ID: "c",
      GITHUB_CLIENT_SECRET: "s",
    };
    expect(checkConfig({ ...GOOD_NODE, ...all }, "node")).toEqual([]);
  });

  it("never puts a value in a message", () => {
    const env = { ...GOOD_NODE, BETTER_AUTH_SECRET: "tiny-secret-value", SMTP_URL: undefined, GITHUB_APP_ID: "12345" };
    const text = JSON.stringify(checkConfig(env, "node"));
    expect(text).not.toContain("tiny-secret-value");
    expect(text).not.toContain("12345");
  });
});

const drivers = await allTestDrivers();
afterAll(() => Promise.all(drivers.map((d) => d.dispose())));

describe.each(drivers)("instanceHealth on $name", (driver) => {
  it("reports nothing on a fresh database", async () => {
    const database = await driver.fresh();
    const health = await instanceHealth(database, GOOD_NODE, "node");
    expect(health).toEqual({ issues: [], driver: driver.name, installations: 0, lastWebhookAt: null, lastReconcile: null });
  });

  it("reports installations, the newest webhook, and the last reconcile run", async () => {
    const database = await driver.fresh();
    const { db } = database;
    await db.insert(githubInstallations).values([
      { id: 9, accountLogin: "acme", accountId: 1, accountType: "Organization" },
      { id: 10, accountLogin: "gone", accountId: 2, accountType: "Organization", deletedAt: new Date(2_000) },
    ]);
    await db.insert(githubWebhookDeliveries).values([
      { deliveryId: "a", event: "ping", receivedAt: new Date(1_000) },
      { deliveryId: "b", event: "issues", receivedAt: new Date(5_000) },
    ]);
    await db.insert(instanceSettings).values({
      key: "reconcile_last_run",
      value: JSON.stringify({ at: "2026-11-10T00:00:00.000Z", status: "error", message: "rate limited" }),
    });
    const health = await instanceHealth(database, {}, "node");
    expect(health.installations).toBe(1);
    expect(health.lastWebhookAt?.getTime()).toBe(5_000);
    expect(health.lastReconcile).toEqual({ at: "2026-11-10T00:00:00.000Z", status: "error", message: "rate limited" });
    expect(health.issues.length).toBeGreaterThan(0);
  });
});
