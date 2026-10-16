/**
 * A linked user's own GitHub token (their App user token). GitHub expires these after 8 hours and
 * invalidates the old refresh token on every refresh, so two refreshes at once can lock the user
 * out. A per-user lease serializes refreshes across isolates.
 */
import { type Db, authIdentities } from "@gitwork/db";
import { and, eq } from "drizzle-orm";
import type { Auth } from "../auth";
import { randomToken } from "../crypto";
import { unavailable } from "../errors";
import { acquireLease, releaseLease } from "../leases";

/** Refresh when less than this is left, so a token never expires in the middle of a request. */
const REFRESH_MARGIN_MS = 60_000;
const LEASE_MS = 30_000;
const WAIT_STEP_MS = 250;
const WAIT_STEPS = 40;

type TokenAuth = Pick<Auth["api"], "getAccessToken" | "refreshToken">;

export interface UserTokenOptions {
  db: Db;
  auth: { api: TokenAuth };
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

async function identityOf(db: Db, userId: string) {
  const [row] = await db
    .select({ id: authIdentities.id, expiresAt: authIdentities.accessTokenExpiresAt })
    .from(authIdentities)
    .where(and(eq(authIdentities.userId, userId), eq(authIdentities.providerId, "github")))
    .limit(1);
  return row ?? null;
}

/**
 * The user's GitHub token, refreshed if needed, or null when the user has not linked GitHub or
 * the link no longer works (refresh token expired or revoked). Callers fall back to the App or
 * ask the user to link again.
 */
export async function userGitHubToken(options: UserTokenOptions, userId: string): Promise<string | null> {
  const { db, auth } = options;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const fresh = (expiresAt: Date | null) => !expiresAt || expiresAt.getTime() - now() > REFRESH_MARGIN_MS;

  let identity = await identityOf(db, userId);
  if (!identity) return null;
  const read = async (accountId: string) => {
    try {
      return (await auth.api.getAccessToken({ body: { accountId, userId } })).accessToken ?? null;
    } catch {
      return null;
    }
  };
  if (fresh(identity.expiresAt)) return read(identity.id);

  const name = `user-token:${userId}`;
  const holder = randomToken(12);
  for (let step = 0; !(await acquireLease(db, name, holder, LEASE_MS, new Date(now()))); step++) {
    if (step >= WAIT_STEPS) throw unavailable("github_busy", "GitHub sign-in is busy. Try again in a moment.");
    await sleep(WAIT_STEP_MS);
    // Someone else may have refreshed it meanwhile.
    identity = await identityOf(db, userId);
    if (!identity) return null;
    if (fresh(identity.expiresAt)) return read(identity.id);
  }
  try {
    identity = await identityOf(db, userId);
    if (!identity) return null;
    if (fresh(identity.expiresAt)) return read(identity.id);
    try {
      const tokens = await auth.api.refreshToken({ body: { accountId: identity.id, userId } });
      return tokens.accessToken ?? null;
    } catch {
      return null;
    }
  } finally {
    await releaseLease(db, name, holder);
  }
}
