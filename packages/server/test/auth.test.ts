import { type Database, invites, rateLimits, verifications, workspaces, accounts } from "@gitwork/db";
import { type TestDriver, allTestDrivers } from "@gitwork/db/testing";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { setSignupPolicy } from "../src/instance-settings";
import { authRequest, cookieFrom, lastCode, testAuth } from "./helpers";

const drivers = await allTestDrivers();
afterAll(() => Promise.all(drivers.map((d) => d.dispose())));

describe.each(drivers)("sign-in on $name", (driver: TestDriver) => {
  let database: Database;
  let ctx: ReturnType<typeof testAuth>;

  beforeEach(async () => {
    database = await driver.fresh();
    ctx = testAuth(database);
  });

  it("emails one code and a link that carries the same code in the fragment", async () => {
    const res = await authRequest(ctx.auth, "/email-otp/send-verification-otp", {
      body: { email: "Jane@Example.com", type: "sign-in" },
    });
    expect(res.status).toBe(200);
    const [message] = ctx.email.messages;
    const code = lastCode(ctx.email.messages);
    expect(message?.to).toBe("jane@example.com");
    expect(message?.text).toContain(`/sign-in/verify#email=jane%40example.com&code=${code}`);
    // The code must never appear in a query string (server logs, link scanners).
    expect(message?.text).not.toMatch(/verify\?/);
  });

  it("stores the code hashed, never in plain text", async () => {
    await authRequest(ctx.auth, "/email-otp/send-verification-otp", { body: { email: "jane@example.com", type: "sign-in" } });
    const code = lastCode(ctx.email.messages);
    const rows = await database.db.select().from(verifications);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.value).not.toContain(code);
  });

  it("signs in with the code and returns a session for the lowercased email", async () => {
    await authRequest(ctx.auth, "/email-otp/send-verification-otp", { body: { email: "Jane@Example.com", type: "sign-in" } });
    const res = await authRequest(ctx.auth, "/sign-in/email-otp", {
      body: { email: "Jane@Example.com", otp: lastCode(ctx.email.messages) },
    });
    expect(res.status).toBe(200);
    const session = await authRequest(ctx.auth, "/get-session", { cookie: cookieFrom(res) });
    const body = (await session.json()) as { user: { email: string } };
    expect(body.user.email).toBe("jane@example.com");
  });

  it("rejects a wrong code", async () => {
    await authRequest(ctx.auth, "/email-otp/send-verification-otp", { body: { email: "jane@example.com", type: "sign-in" } });
    const code = lastCode(ctx.email.messages);
    const wrong = code === "000000" ? "111111" : "000000";
    const res = await authRequest(ctx.auth, "/sign-in/email-otp", { body: { email: "jane@example.com", otp: wrong } });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("rate-limits code requests per IP, with counters in the database", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await authRequest(ctx.auth, "/email-otp/send-verification-otp", {
        body: { email: `user${i}@example.com`, type: "sign-in" },
        ip: "198.51.100.9",
      });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(statuses[5]).toBe(429);
    expect((await database.db.select().from(rateLimits)).length).toBeGreaterThan(0);
  });

  describe("invite-only sign-ups", () => {
    beforeEach(async () => {
      await setSignupPolicy(database.db, "invite-only");
    });

    it("refuses to create a user with no invite", async () => {
      await authRequest(ctx.auth, "/email-otp/send-verification-otp", { body: { email: "stranger@example.com", type: "sign-in" } });
      const res = await authRequest(ctx.auth, "/sign-in/email-otp", {
        body: { email: "stranger@example.com", otp: lastCode(ctx.email.messages) },
      });
      expect(res.status).toBe(403);
    });

    it("creates a user who has a valid pending invite", async () => {
      await database.db.insert(accounts).values({ id: "a1", name: "Acme" });
      await database.db.insert(workspaces).values({ id: "w1", accountId: "a1", name: "Site" });
      await database.db.insert(invites).values({
        id: "i1",
        workspaceId: "w1",
        email: "guest@example.com",
        role: "read_only",
        tokenHash: "hash",
        expiresAt: new Date(Date.now() + 60_000),
      });
      await authRequest(ctx.auth, "/email-otp/send-verification-otp", { body: { email: "Guest@Example.com", type: "sign-in" } });
      const res = await authRequest(ctx.auth, "/sign-in/email-otp", {
        body: { email: "Guest@Example.com", otp: lastCode(ctx.email.messages) },
      });
      expect(res.status).toBe(200);
    });
  });
});
