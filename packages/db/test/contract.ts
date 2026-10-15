import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { instanceSettings } from "../src/schema";
import type { Database } from "../src/types";

/** Behavior every driver must share. Each driver's test file runs this suite. */
export function databaseContract(getDatabase: () => Database) {
  it("round-trips a row", async () => {
    const { db } = getDatabase();
    await db.insert(instanceSettings).values({ key: "round-trip", value: "v1" });
    const rows = await db.select().from(instanceSettings).where(eq(instanceSettings.key, "round-trip"));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.value).toBe("v1");
    expect(rows[0]?.updatedAt).toBeInstanceOf(Date);
  });

  it("applies every statement in a batch", async () => {
    const { db } = getDatabase();
    await db.batch([
      db.insert(instanceSettings).values({ key: "batch-a", value: "a" }),
      db.insert(instanceSettings).values({ key: "batch-b", value: "b" }),
    ]);
    const rows = await db.select().from(instanceSettings);
    expect(rows.map((r) => r.key)).toEqual(expect.arrayContaining(["batch-a", "batch-b"]));
  });

  it("rolls back the whole batch when one statement fails", async () => {
    const { db } = getDatabase();
    await db.insert(instanceSettings).values({ key: "taken", value: "x" });
    await expect(
      db.batch([
        db.insert(instanceSettings).values({ key: "atomic-first", value: "1" }),
        db.insert(instanceSettings).values({ key: "taken", value: "duplicate" }),
      ]),
    ).rejects.toThrow();
    const rows = await db.select().from(instanceSettings).where(eq(instanceSettings.key, "atomic-first"));
    expect(rows).toHaveLength(0);
  });
}

/** Schema constraints that SQLite only enforces when written as CHECKs. */
export function constraintContract(getDatabase: () => Database) {
  it("rejects an unknown role and an uppercase invite email", async () => {
    const { db } = getDatabase();
    const { accounts, workspaces, invites } = await import("../src/schema");
    await db.insert(accounts).values({ id: "a1", name: "Acme" });
    await db.insert(workspaces).values({ id: "w1", accountId: "a1", name: "Site" });
    const base = { workspaceId: "w1", expiresAt: new Date(Date.now() + 1000) };
    await expect(
      db.insert(invites).values({ ...base, id: "i1", email: "x@y.z", role: "superuser" as "owner", tokenHash: "h1" }),
    ).rejects.toThrow();
    await expect(
      db.insert(invites).values({ ...base, id: "i2", email: "X@Y.Z", role: "member", tokenHash: "h2" }),
    ).rejects.toThrow();
    await db.insert(invites).values({ ...base, id: "i3", email: "x@y.z", role: "member", tokenHash: "h3" });
  });
}
