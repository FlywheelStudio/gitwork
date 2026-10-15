import { type Db, rateLimits } from "@gitwork/db";
import { sql } from "drizzle-orm";
import { newId } from "./crypto";

/**
 * Fixed-window counter in `rate_limits`, as one atomic upsert (works on D1 and libsql).
 * Returns true when this hit is within the limit. Keys are prefixed so they never collide with
 * Better Auth's own `ip|path` keys in the same table.
 */
export async function hitLimit(
  db: Db,
  key: string,
  limit: { windowMs: number; max: number },
  now = Date.now(),
): Promise<boolean> {
  const windowStart = now - limit.windowMs;
  const [row] = await db
    .insert(rateLimits)
    .values({ id: newId(), key: `gitwork:${key}`, count: 1, lastRequest: now })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`CASE WHEN ${rateLimits.lastRequest} < ${windowStart} THEN 1 ELSE ${rateLimits.count} + 1 END`,
        lastRequest: sql`CASE WHEN ${rateLimits.lastRequest} < ${windowStart} THEN ${now} ELSE ${rateLimits.lastRequest} END`,
      },
    })
    .returning({ count: rateLimits.count });
  return (row?.count ?? 1) <= limit.max;
}

/** Sign-in codes per email address: stops flooding one inbox regardless of client IP. */
export const OTP_PER_EMAIL = { windowMs: 15 * 60_000, max: 5 };
/** Invites sent per user: stops an open instance from becoming a spam relay. */
export const INVITES_PER_USER = { windowMs: 60 * 60_000, max: 30 };
