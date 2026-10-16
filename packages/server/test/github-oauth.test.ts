import { authIdentities, users } from "@gitwork/db";
import { sqliteTestDriver } from "@gitwork/db/testing";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAuth } from "../src/auth";
import { memorySender } from "../src/email";
import { BASE_URL, authRequest, cookieFrom, signIn } from "./helpers";

/**
 * The GitHub link round trip with GitHub stubbed at `fetch`: authorize → callback → token exchange
 * → profile → stored identity, then a token refresh (App user tokens expire after 8 hours).
 */
describe("GitHub OAuth link callback", () => {
  const realFetch = globalThis.fetch;
  let tokenCalls: URLSearchParams[] = [];

  function stubGitHub(profile: { id: number; email: string | null }) {
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.startsWith("https://github.com/login/oauth/access_token")) {
        const params = new URLSearchParams(init?.body instanceof URLSearchParams ? init.body : String(init?.body ?? ""));
        tokenCalls.push(params);
        const n = tokenCalls.length;
        return Response.json({
          access_token: `ghu_access_${n}`,
          expires_in: 28800,
          refresh_token: `ghr_refresh_${n}`,
          refresh_token_expires_in: 15897600,
          token_type: "bearer",
          scope: "",
        });
      }
      if (url === "https://api.github.com/user") {
        return Response.json({ id: profile.id, login: "octo", name: "Octo Cat", email: profile.email, avatar_url: "" });
      }
      if (url === "https://api.github.com/user/emails") {
        return Response.json([{ email: "octo@users.noreply.github.com", primary: true, verified: true }]);
      }
      return realFetch(input, init);
    });
  }

  let auth: ReturnType<typeof createAuth>;
  let email: ReturnType<typeof memorySender>;
  let db: Awaited<ReturnType<ReturnType<typeof sqliteTestDriver>["fresh"]>>["db"];

  beforeEach(async () => {
    tokenCalls = [];
    email = memorySender();
    const database = await sqliteTestDriver().fresh();
    db = database.db;
    auth = createAuth({
      database,
      secret: "test-secret-test-secret-test-secret-32",
      baseURL: BASE_URL,
      email,
      github: { clientId: "Iv1.app", clientSecret: "app-secret" },
      trustedIpHeader: "cf-connecting-ip",
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function linkFlow(cookie: string) {
    const start = await authRequest(auth, "/link-social", { cookie, body: { provider: "github", callbackURL: "/settings" } });
    const { url } = (await start.json()) as { url: string };
    const state = new URL(url).searchParams.get("state")!;
    const stateCookie = cookieFrom(start);
    const allCookies = [cookie, stateCookie].filter(Boolean).join("; ");
    return authRequest(auth, `/callback/github?code=gh-code&state=${encodeURIComponent(state)}`, { cookie: allCookies });
  }

  it("links GitHub with a different, private email and stores encrypted, refreshable tokens", async () => {
    const cookie = await signIn(auth, email, "jane@agency.com");
    stubGitHub({ id: 12345, email: null });
    const res = await linkFlow(cookie);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("/settings");

    const [identity] = await db.select().from(authIdentities).where(eq(authIdentities.providerId, "github"));
    expect(identity?.accountId).toBe("12345");
    expect(identity?.accessToken).toBeTruthy();
    expect(identity?.accessToken).not.toBe("ghu_access_1"); // encrypted at rest
    expect(identity?.refreshToken).not.toBe("ghr_refresh_1");
    expect(identity?.refreshToken).toBeTruthy();
    const hours = (identity!.accessTokenExpiresAt!.getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(7.9);
    expect(hours).toBeLessThan(8.1);
    // The user keeps their own email.
    expect((await db.select().from(users))[0]?.email).toBe("jane@agency.com");

    // Expire the access token; asking for it refreshes it once with the refresh token.
    await db.update(authIdentities).set({ accessTokenExpiresAt: new Date(Date.now() - 1000) }).where(eq(authIdentities.id, identity!.id));
    const token = await auth.api.getAccessToken({ body: { accountId: identity!.id, userId: identity!.userId } });
    expect(token.accessToken).toBe("ghu_access_2");
    expect(tokenCalls[1]?.get("grant_type")).toBe("refresh_token");
    expect(tokenCalls[1]?.get("refresh_token")).toBe("ghr_refresh_1");
  });

  it("never creates a user from a GitHub sign-in (link only)", async () => {
    stubGitHub({ id: 999, email: "new@example.com" });
    const start = await authRequest(auth, "/sign-in/social", { body: { provider: "github", callbackURL: "/" } });
    const { url } = (await start.json()) as { url: string };
    const state = new URL(url).searchParams.get("state")!;
    const res = await authRequest(auth, `/callback/github?code=gh-code&state=${encodeURIComponent(state)}`, { cookie: cookieFrom(start) });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toMatch(/error/);
    expect(await db.select().from(users)).toHaveLength(0);
  });
});
