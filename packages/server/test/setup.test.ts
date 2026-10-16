import { type Database, githubApp, githubInstallations, users } from "@gitwork/db";
import { type TestDriver, allTestDrivers } from "@gitwork/db/testing";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ServiceError } from "../src/errors";
import { loadGitHubAppConfig } from "../src/github/config";
import { completeManifestFlow, confirmInstallation, startManifestFlow } from "../src/github/setup";
import { setSignupPolicy } from "../src/instance-settings";
import { createAccountWithWorkspace } from "../src/services/accounts";
import { mayCreateUser } from "../src/signup";
import { githubContext } from "./github-helpers";

const drivers = await allTestDrivers();
afterAll(() => Promise.all(drivers.map((d) => d.dispose())));

const BASE = "https://gitwork.example";
const CONVERSION = {
  id: 777,
  slug: "acme-gitwork",
  client_id: "Iv1.created",
  client_secret: "client-secret-value",
  webhook_secret: "webhook-secret-value",
  pem: "-----BEGIN RSA PRIVATE KEY-----\nAAAA\n-----END RSA PRIVATE KEY-----",
  html_url: "https://github.com/apps/acme-gitwork",
  owner: { login: "acme" },
};
const conversionFetch = (async (url: string | URL | Request) => {
  expect(String(url)).toBe("https://api.github.com/app-manifests/the-code/conversions");
  return Response.json(CONVERSION, { status: 201 });
}) as typeof fetch;

async function status(promise: Promise<unknown>) {
  const e = await promise.then(() => null, (err: unknown) => err);
  return e instanceof ServiceError ? `${e.status} ${e.code}` : String(e);
}

describe.each(drivers)("instance setup on $name", (driver: TestDriver) => {
  let database: Database;
  let ctx: Awaited<ReturnType<typeof githubContext>>;
  const start = (userId = "admin", now?: Date) => startManifestFlow(ctx.db, { userId, baseURL: BASE, org: "acme" }, now);
  const stateOf = (action: string) => new URL(action).searchParams.get("state")!;

  beforeEach(async () => {
    database = await driver.fresh();
    ctx = await githubContext(database);
    await ctx.db.insert(users).values([
      { id: "admin", name: "Admin", email: "admin@example.com" },
      { id: "other", name: "Other", email: "other@example.com" },
    ]);
  });

  it("builds an org manifest with the webhook, callback, and email permission", async () => {
    const { action, manifest } = await start();
    expect(action).toMatch(/^https:\/\/github\.com\/organizations\/acme\/settings\/apps\/new\?state=/);
    expect(manifest.hook_attributes.url).toBe(`${BASE}/api/github/webhook`);
    expect(manifest.callback_urls).toEqual([`${BASE}/api/auth/callback/github`]);
    expect(manifest.default_permissions).toMatchObject({ organization_projects: "write", email_addresses: "read" });
    expect(manifest.default_events).not.toContain("installation");
    expect(manifest.public).toBe(false);
  });

  it("rejects a bad org name", async () => {
    expect(await status(startManifestFlow(ctx.db, { userId: "admin", baseURL: BASE, org: "evil/../x" }))).toBe("400 invalid");
  });

  it("stores the created App with sealed secrets", async () => {
    const { action } = await start();
    await completeManifestFlow(ctx.db, ctx.box, { code: "the-code", state: stateOf(action), userId: "admin" }, conversionFetch);
    const [row] = await ctx.db.select().from(githubApp);
    expect(row?.slug).toBe("acme-gitwork");
    expect(JSON.stringify(row)).not.toContain("client-secret-value");
    expect(JSON.stringify(row)).not.toContain("webhook-secret-value");
    const config = await loadGitHubAppConfig(ctx.db, ctx.box, {});
    expect(config).toMatchObject({ appId: "777", clientSecret: "client-secret-value", webhookSecret: "webhook-secret-value", source: "database" });
  });

  it("refuses a reused, foreign, or expired state", async () => {
    const { action } = await start();
    const state = stateOf(action);
    expect(await status(completeManifestFlow(ctx.db, ctx.box, { code: "the-code", state, userId: "other" }, conversionFetch))).toBe(
      "403 invalid_state",
    );
    await completeManifestFlow(ctx.db, ctx.box, { code: "the-code", state, userId: "admin" }, conversionFetch);
    expect(await status(completeManifestFlow(ctx.db, ctx.box, { code: "the-code", state, userId: "admin" }, conversionFetch))).toBe(
      "403 invalid_state",
    );

    await ctx.db.delete(githubApp);
    const old = await start("admin", new Date("2026-01-01T00:00:00Z"));
    expect(
      await status(completeManifestFlow(ctx.db, ctx.box, { code: "the-code", state: stateOf(old.action), userId: "admin" }, conversionFetch)),
    ).toBe("403 invalid_state");
  });

  it("never overwrites an existing App", async () => {
    const first = await start();
    const second = await start();
    await completeManifestFlow(ctx.db, ctx.box, { code: "the-code", state: stateOf(first.action), userId: "admin" }, conversionFetch);
    expect(
      await status(completeManifestFlow(ctx.db, ctx.box, { code: "the-code", state: stateOf(second.action), userId: "admin" }, conversionFetch)),
    ).toBe("409 app_exists");
    expect(await status(start())).toBe("409 app_exists");
    expect(await ctx.db.select().from(githubApp)).toHaveLength(1);
  });

  it("prefers environment credentials over the database", async () => {
    const config = await loadGitHubAppConfig(ctx.db, ctx.box, {
      GITHUB_APP_ID: "1",
      GITHUB_APP_PRIVATE_KEY: "-----BEGIN RSA PRIVATE KEY-----\\nX\\n-----END RSA PRIVATE KEY-----",
      GITHUB_WEBHOOK_SECRET: "w",
      GITHUB_CLIENT_ID: "c",
      GITHUB_CLIENT_SECRET: "s",
    });
    expect(config?.source).toBe("env");
    expect(config?.privateKeyPem).toContain("\nX\n");
  });

  it("records an installation only after GitHub confirms it with the App JWT", async () => {
    await confirmInstallation(ctx.db, ctx.client, 55);
    expect((await ctx.db.select().from(githubInstallations))[0]).toMatchObject({ id: 55, accountLogin: "acme" });
    expect(await confirmInstallation(ctx.db, ctx.client, 404).catch((e: Error) => e.name)).toBe("GitHubError");
    expect(await ctx.db.select().from(githubInstallations)).toHaveLength(1);
  });

  it("lets instance admins sign up and create Accounts on an invite-only instance", async () => {
    await setSignupPolicy(ctx.db, "invite-only");
    expect(await mayCreateUser(ctx.db, "Admin@Example.com", new Date(), ["admin@example.com"])).toBe(true);
    expect(await mayCreateUser(ctx.db, "stranger@example.com", new Date(), ["admin@example.com"])).toBe(false);
    await createAccountWithWorkspace(ctx.db, { userId: "other", accountName: "First", workspaceName: "W" });
    expect(await status(createAccountWithWorkspace(ctx.db, { userId: "admin", accountName: "A", workspaceName: "W" }))).toBe(
      "403 account_creation_closed",
    );
    await createAccountWithWorkspace(ctx.db, { userId: "admin", accountName: "A", workspaceName: "W", isInstanceAdmin: true });
  });
});
