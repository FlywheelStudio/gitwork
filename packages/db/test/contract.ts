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
