import type { Database } from "@gitwork/db";
import { type TestDriver, allTestDrivers } from "@gitwork/db/testing";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { ApiDeps } from "../src/api/router";
import { handleApiRequest } from "../src/api/routes";
import { BASE_URL, signIn, testAuth } from "./helpers";

const drivers = await allTestDrivers();
afterAll(() => Promise.all(drivers.map((d) => d.dispose())));

describe.each(drivers)("/api/v1 on $name", (driver: TestDriver) => {
  let database: Database;
  let ctx: ReturnType<typeof testAuth>;
  let deps: ApiDeps;

  function api(
    method: string,
    path: string,
    opts: { cookie?: string; body?: unknown; origin?: string | null; bearer?: string } = {},
  ) {
    const headers = new Headers();
    if (opts.cookie) headers.set("cookie", opts.cookie);
    if (opts.bearer) headers.set("authorization", `Bearer ${opts.bearer}`);
    if (opts.origin !== null) headers.set("origin", opts.origin ?? BASE_URL);
    if (opts.body !== undefined) headers.set("content-type", "application/json");
    return handleApiRequest(
      new Request(`${BASE_URL}/api/v1${path}`, {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      }),
      deps,
    );
  }

  /** Signs in, creates an Account + workspace, returns the owner's cookie and workspace id. */
  async function ownerWithWorkspace() {
    const cookie = await signIn(ctx.auth, ctx.email, "owner@example.com");
    const res = await api("POST", "/accounts", { cookie, body: { accountName: "Acme", workspaceName: "Website" } });
    expect(res.status).toBe(200);
    const { workspaceId } = (await res.json()) as { workspaceId: string };
    return { cookie, workspaceId };
  }

  beforeEach(async () => {
    database = await driver.fresh();
    ctx = testAuth(database);
    deps = { database, auth: ctx.auth, email: ctx.email, baseURL: BASE_URL };
  });

  it("returns 401 without a session", async () => {
    expect((await api("GET", "/me")).status).toBe(401);
    expect((await api("POST", "/accounts", { body: { accountName: "A", workspaceName: "W" } })).status).toBe(401);
  });

  it("returns 404 for unknown paths and 405 for wrong methods", async () => {
    const cookie = await signIn(ctx.auth, ctx.email, "a@example.com");
    expect((await api("GET", "/nope", { cookie })).status).toBe(404);
    expect((await api("DELETE", "/me", { cookie })).status).toBe(405);
  });

  it("validates bodies with 400", async () => {
    const cookie = await signIn(ctx.auth, ctx.email, "a@example.com");
    const res = await api("POST", "/accounts", { cookie, body: { accountName: "", workspaceName: "W" } });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("invalid");
    expect((await api("POST", "/accounts", { cookie, body: "not json" })).status).toBe(400);
  });

  it("refuses cross-site cookie writes with 403", async () => {
    const cookie = await signIn(ctx.auth, ctx.email, "a@example.com");
    const body = { accountName: "A", workspaceName: "W" };
    expect((await api("POST", "/accounts", { cookie, body, origin: "https://evil.example" })).status).toBe(403);
    expect((await api("POST", "/accounts", { cookie, body, origin: null })).status).toBe(403);
    expect((await api("POST", "/accounts", { cookie, body })).status).toBe(200);
  });

  it("accepts a bearer token without an Origin header", async () => {
    await signIn(ctx.auth, ctx.email, "mac@example.com");
    const sent = await ctx.auth.api.signInEmailOTP({
      body: { email: "mac@example.com", otp: await (async () => {
        await ctx.auth.api.sendVerificationOTP({ body: { email: "mac@example.com", type: "sign-in" } });
        return /code is (\d{6})/.exec(ctx.email.messages.at(-1)!.text)![1]!;
      })() },
    });
    const res = await api("POST", "/accounts", {
      bearer: sent.token,
      origin: null,
      body: { accountName: "Mac", workspaceName: "W" },
    });
    expect(res.status).toBe(200);
  });

  it("shows the workspace with the caller's role and capabilities", async () => {
    const { cookie, workspaceId } = await ownerWithWorkspace();
    const res = await api("GET", `/workspaces/${workspaceId}`, { cookie });
    const body = (await res.json()) as { role: string; capabilities: string[]; hasGitHub: boolean };
    expect(body.role).toBe("owner");
    expect(body.hasGitHub).toBe(false);
    expect(body.capabilities).toContain("members.invite");
    // GitHub tasks need a linked account (decision 017).
    expect(body.capabilities).not.toContain("workspace.github_settings");
  });

  it("hides a workspace from non-members with 404", async () => {
    const { workspaceId } = await ownerWithWorkspace();
    const stranger = await signIn(ctx.auth, ctx.email, "stranger@example.com");
    expect((await api("GET", `/workspaces/${workspaceId}`, { cookie: stranger })).status).toBe(404);
    expect((await api("GET", `/workspaces/${workspaceId}/members`, { cookie: stranger })).status).toBe(404);
  });

  it("runs the invite flow end to end and enforces roles", async () => {
    const { cookie: owner, workspaceId } = await ownerWithWorkspace();

    const invited = await api("POST", `/workspaces/${workspaceId}/invites`, {
      cookie: owner,
      body: { email: "Client@Example.com", role: "read_only" },
    });
    expect(invited.status).toBe(200);
    const mail = ctx.email.messages.at(-1)!;
    expect(mail.to).toBe("client@example.com");
    const token = /\/invite\/([A-Za-z0-9_-]+)/.exec(mail.text)![1]!;

    const preview = (await (await api("GET", `/invites/${token}`, { origin: null })).json()) as { status: string; role: string };
    expect(preview).toMatchObject({ status: "pending", role: "read_only" });

    const client = await signIn(ctx.auth, ctx.email, "client@example.com");
    const accepted = await api("POST", `/invites/${token}/accept`, { cookie: client });
    expect(accepted.status).toBe(200);

    const me = (await (await api("GET", "/me", { cookie: client })).json()) as { workspaces: { role: string }[] };
    expect(me.workspaces).toEqual([expect.objectContaining({ role: "read_only" })]);

    // Read Only cannot invite.
    const denied = await api("POST", `/workspaces/${workspaceId}/invites`, {
      cookie: client,
      body: { email: "x@example.com", role: "read_only" },
    });
    expect(denied.status).toBe(403);

    // The Owner can promote the client to Member.
    const members = (await (await api("GET", `/workspaces/${workspaceId}/members`, { cookie: owner })).json()) as {
      members: { userId: string; email: string }[];
    };
    const clientId = members.members.find((m) => m.email === "client@example.com")!.userId;
    expect((await api("PATCH", `/workspaces/${workspaceId}/members/${clientId}`, { cookie: owner, body: { role: "member" } })).status).toBe(204);
    expect((await api("PATCH", `/workspaces/${workspaceId}/members/${clientId}`, { cookie: owner, body: { role: "boss" } })).status).toBe(400);
  });
});
