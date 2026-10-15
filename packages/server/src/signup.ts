import { type Db, invites } from "@gitwork/db";
import { and, eq, gt, isNull } from "drizzle-orm";
import { getSignupPolicy } from "./instance-settings";

/** A new user may be created when sign-ups are open, or when a valid invite exists for the email. */
export async function mayCreateUser(db: Db, email: string, now = new Date()): Promise<boolean> {
  if ((await getSignupPolicy(db)) === "open") return true;
  const [invite] = await db
    .select({ id: invites.id })
    .from(invites)
    .where(
      and(
        eq(invites.email, email.toLowerCase()),
        isNull(invites.acceptedAt),
        isNull(invites.revokedAt),
        gt(invites.expiresAt, now),
      ),
    )
    .limit(1);
  return invite !== undefined;
}
