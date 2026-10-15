import { type Db, instanceSettings } from "@gitwork/db";
import { eq } from "drizzle-orm";

export type SignupPolicy = "open" | "invite-only";

/** Who may create a new user (decision 017). Default `open` until the setup wizard exists. */
export async function getSignupPolicy(db: Db): Promise<SignupPolicy> {
  const [row] = await db.select().from(instanceSettings).where(eq(instanceSettings.key, "signups"));
  return row?.value === "invite-only" ? "invite-only" : "open";
}

export async function setSignupPolicy(db: Db, policy: SignupPolicy): Promise<void> {
  await db
    .insert(instanceSettings)
    .values({ key: "signups", value: policy })
    .onConflictDoUpdate({ target: instanceSettings.key, set: { value: policy, updatedAt: new Date() } });
}
