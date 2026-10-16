/** Named leases in `sync_leases`: one holder at a time across isolates and Node instances. */
import { type Db, syncLeases } from "@gitwork/db";
import { and, eq, lt } from "drizzle-orm";

/** Takes the lease if it is free or expired. One statement, so two callers never both win. */
export async function acquireLease(db: Db, name: string, holder: string, ttlMs: number, now: Date): Promise<boolean> {
  const expiresAt = new Date(now.getTime() + ttlMs);
  const [row] = await db
    .insert(syncLeases)
    .values({ name, holder, expiresAt })
    .onConflictDoUpdate({ target: syncLeases.name, set: { holder, expiresAt }, setWhere: lt(syncLeases.expiresAt, now) })
    .returning({ holder: syncLeases.holder });
  return row?.holder === holder;
}

export async function releaseLease(db: Db, name: string, holder: string): Promise<void> {
  await db.delete(syncLeases).where(and(eq(syncLeases.name, name), eq(syncLeases.holder, holder)));
}
