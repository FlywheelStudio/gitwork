import { githubApp, users } from "@gitwork/db";
import { sqliteTestDriver } from "@gitwork/db/testing";
import { describe, expect, it } from "vitest";
import type { ApiDeps } from "../src/api/router";
import { handleApiRequest } from "../src/api/routes";
import { createRequestDeps } from "../src/deps";
import { memorySender } from "../src/email";
import { createSecretBox } from "../src/github/crypto";
import { BASE_URL, signIn } from "./helpers";

describe("createRequestDeps after BETTER_AUTH_SECRET changes", () => {
  it("keeps sign-in working, reports the broken App, and lets an admin replace it", async () => {
    const database = await sqliteTestDriver().fresh();
    // An App stored under the old secret.
    const oldBox = await createSecretBox("old-secret-old-secret-old-secret-32");
    await database.db.insert(githubApp).values({
      id: 1, appId: "1", slug: "old", clientId: "Iv1.old", htmlUrl: "https://github.com/apps/old", ownerLogin: "acme",
      clientSecret: await oldBox.seal("x", "github_app.client_secret"),
      webhookSecret: await oldBox.seal("x", "github_app.webhook_secret"),
      privateKey: await oldBox.seal("x", "github_app.private_key"),
    });

    const email = memorySender();
    const deps = await createRequestDeps({
      database,
      env: {},
      email,
      secret: "new-secret-new-secret-new-secret-32",
      baseURL: BASE_URL,
      trustedIpHeader: "cf-connecting-ip",
      instanceAdminEmails: ["admin@example.com"],
    });
    expect(deps.github).toBeNull();
    expect(deps.githubError).toBe("undecryptable");

    // Sign-in still works.
    const cookie = await signIn(deps.auth, email, "admin@example.com");
    const api = (method: string, path: string) =>
      handleApiRequest(new Request(`${BASE_URL}/api/v1${path}`, { method, headers: { cookie, origin: BASE_URL } }), deps as ApiDeps);

    const setup = (await (await api("GET", "/setup")).json()) as { github: { configured: boolean; error: string } };
    expect(setup.github).toEqual({ configured: false, error: "undecryptable" });

    expect((await api("DELETE", "/setup/github")).status).toBe(204);
    expect(await database.db.select().from(githubApp)).toHaveLength(0);
    expect((await database.db.select().from(users)).map((u) => u.email)).toEqual(["admin@example.com"]);
  });

  it("refuses replace for non-admins", async () => {
    const database = await sqliteTestDriver().fresh();
    const email = memorySender();
    const deps = await createRequestDeps({
      database, env: {}, email, secret: "s-s-s-s-s-s-s-s-s-s-s-s-s-s-s-s", baseURL: BASE_URL,
      trustedIpHeader: "cf-connecting-ip", instanceAdminEmails: ["admin@example.com"],
    });
    const cookie = await signIn(deps.auth, email, "user@example.com");
    const res = await handleApiRequest(
      new Request(`${BASE_URL}/api/v1/setup/github`, { method: "DELETE", headers: { cookie, origin: BASE_URL } }),
      deps,
    );
    expect(res.status).toBe(403);
  });
});
