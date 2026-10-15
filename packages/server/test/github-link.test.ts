import { sqliteTestDriver } from "@gitwork/db/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { createAuth } from "../src/auth";
import { memorySender } from "../src/email";
import { BASE_URL, authRequest, signIn } from "./helpers";

// The OAuth round trip needs a real GitHub App (Phase 2). These cover what runs before GitHub.
describe("GitHub linking", () => {
  let auth: ReturnType<typeof createAuth>;
  let email: ReturnType<typeof memorySender>;

  beforeEach(async () => {
    email = memorySender();
    auth = createAuth({
      database: await sqliteTestDriver().fresh(),
      secret: "test-secret-test-secret-test-secret-32",
      baseURL: BASE_URL,
      email,
      github: { clientId: "Iv1.testclient", clientSecret: "shh" },
    });
  });

  it("needs a signed-in user", async () => {
    const res = await authRequest(auth, "/link-social", { body: { provider: "github", callbackURL: "/settings" } });
    expect(res.status).toBe(401);
  });

  it("sends a signed-in user to GitHub's authorize page with the App's client id", async () => {
    const cookie = await signIn(auth, email, "dev@example.com");
    const res = await authRequest(auth, "/link-social", { cookie, body: { provider: "github", callbackURL: "/settings" } });
    expect(res.status).toBe(200);
    const { url } = (await res.json()) as { url: string };
    const authorize = new URL(url);
    expect(authorize.origin + authorize.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(authorize.searchParams.get("client_id")).toBe("Iv1.testclient");
    expect(authorize.searchParams.get("redirect_uri")).toBe(`${BASE_URL}/api/auth/callback/github`);
  });

  it("is absent when no GitHub credentials are configured", async () => {
    const plain = createAuth({
      database: await sqliteTestDriver().fresh(),
      secret: "test-secret-test-secret-test-secret-32",
      baseURL: BASE_URL,
      email,
    });
    const cookie = await signIn(plain, email, "dev@example.com");
    const res = await authRequest(plain, "/link-social", { cookie, body: { provider: "github", callbackURL: "/settings" } });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
