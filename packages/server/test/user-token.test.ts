import { type Database, authIdentities, syncLeases, users } from "@gitwork/db";
import { type TestDriver, allTestDrivers } from "@gitwork/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { userGitHubToken } from "../src/github/user-token";

const drivers = await allTestDrivers();
afterAll(() => Promise.all(drivers.map((d) => d.dispose())));

describe.each(drivers)("userGitHubToken on $name", (driver: TestDriver) => {
  let database: Database;
  let refreshes = 0;
  let reads = 0;

  /** A stand-in for Better Auth: refresh writes a new expiry, like the real endpoint does. */
  const auth = {
    api: {
      getAccessToken: async () => {
        reads++;
        return { accessToken: "ghu_current" };
      },
      refreshToken: async ({ body }: { body: { accountId: string } }) => {
        refreshes++;
        await new Promise((r) => setTimeout(r, 30));
        await database.db
          .update(authIdentities)
          .set({ accessTokenExpiresAt: new Date(Date.now() + 8 * 3_600_000) })
          .where(eq(authIdentities.id, body.accountId));
        return { accessToken: `ghu_refreshed_${refreshes}` };
      },
    },
  } as never;

  async function link(expiresInMs: number) {
    await database.db.insert(users).values({ id: "u1", name: "Jane", email: "jane@example.com" });
    await database.db.insert(authIdentities).values({
      id: "ident1",
      accountId: "12345",
      providerId: "github",
      userId: "u1",
      accessToken: "sealed",
      accessTokenExpiresAt: new Date(Date.now() + expiresInMs),
    });
  }

  beforeEach(async () => {
    database = await driver.fresh();
    refreshes = 0;
    reads = 0;
  });

  it("returns null when the user has not linked GitHub", async () => {
    expect(await userGitHubToken({ db: database.db, auth }, "nobody")).toBeNull();
  });

  it("reads a fresh token without taking the lease", async () => {
    await link(3_600_000);
    expect(await userGitHubToken({ db: database.db, auth }, "u1")).toBe("ghu_current");
    expect(refreshes).toBe(0);
    expect(await database.db.select().from(syncLeases)).toHaveLength(0);
  });

  it("refreshes a token close to expiry, and releases the lease", async () => {
    await link(10_000);
    expect(await userGitHubToken({ db: database.db, auth }, "u1")).toBe("ghu_refreshed_1");
    expect(refreshes).toBe(1);
    expect(await database.db.select().from(syncLeases)).toHaveLength(0);
  });

  it("refreshes once when two requests need a refresh at the same time", async () => {
    await link(-1_000);
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.min(ms, 10)));
    const [a, b] = await Promise.all([
      userGitHubToken({ db: database.db, auth, sleep }, "u1"),
      userGitHubToken({ db: database.db, auth, sleep }, "u1"),
    ]);
    expect(refreshes).toBe(1);
    expect([a, b].sort()).toEqual(["ghu_current", "ghu_refreshed_1"]);
    expect(reads).toBe(1);
  });

  it("returns null when the refresh fails (link revoked), and releases the lease", async () => {
    await link(-1_000);
    const broken = { api: { ...(auth as { api: object }).api, refreshToken: async () => Promise.reject(new Error("bad_refresh_token")) } } as never;
    expect(await userGitHubToken({ db: database.db, auth: broken }, "u1")).toBeNull();
    expect(await database.db.select().from(syncLeases)).toHaveLength(0);
  });

  it("gives up with 503 when another holder keeps the lease", async () => {
    await link(-1_000);
    await database.db.insert(syncLeases).values({ name: "user-token:u1", holder: "other", expiresAt: new Date(Date.now() + 60_000) });
    await expect(userGitHubToken({ db: database.db, auth, sleep: async () => {} }, "u1")).rejects.toMatchObject({ status: 503 });
  });
});
