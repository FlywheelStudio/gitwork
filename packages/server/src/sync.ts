/**
 * Light entry for the scheduled reconcile (Worker cron and Node timer): no Better Auth, no email.
 */
import { type Database, githubManifestStates, githubWebhookDeliveries, instanceSettings, rateLimits } from "@gitwork/db";
import { lt } from "drizzle-orm";
import { GitHubClient } from "./github/client";
import { loadGitHubAppConfig } from "./github/config";
import { createSecretBox } from "./github/crypto";
import { reconcile } from "./github/reconcile";

export type ScheduledRun =
  | { at: string; status: "skipped"; reason: "no_secret" | "no_app" }
  | { at: string; status: "done"; synced: number; failed: number; rateLimited: boolean; leaseHeld: boolean }
  | { at: string; status: "error"; message: string };

/** One reconcile pass. Never throws: the outcome is returned and stored in instance_settings. */
export async function runScheduledReconcile(
  database: Database,
  env: Record<string, string | undefined>,
  holder: string,
  fetchImpl?: typeof fetch,
): Promise<ScheduledRun> {
  const at = new Date().toISOString();
  let run: ScheduledRun;
  try {
    if (!env.BETTER_AUTH_SECRET) {
      run = { at, status: "skipped", reason: "no_secret" };
    } else {
      const box = await createSecretBox(env.BETTER_AUTH_SECRET);
      const app = await loadGitHubAppConfig(database.db, box, env);
      if (!app) {
        run = { at, status: "skipped", reason: "no_app" };
      } else {
        const client = new GitHubClient({ db: database.db, box, app, fetch: fetchImpl });
        const result = await reconcile({
          db: database.db,
          client,
          holder,
          maxTargets: positive(env.RECONCILE_MAX_TARGETS),
          maxPages: positive(env.RECONCILE_MAX_PAGES),
        });
        run = {
          at,
          status: "done",
          synced: result.synced.length,
          failed: result.failed.length,
          rateLimited: result.rateLimited,
          leaseHeld: result.skipped === "lease_held",
        };
      }
    }
  } catch (error) {
    run = { at, status: "error", message: (error as Error).message };
  }
  await prune(database).catch(() => undefined);
  const value = JSON.stringify(run);
  await database.db
    .insert(instanceSettings)
    .values({ key: "reconcile_last_run", value })
    .onConflictDoUpdate({ target: instanceSettings.key, set: { value, updatedAt: new Date() } });
  return run;
}

function positive(value: string | undefined): number | undefined {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

const DAY = 24 * 60 * 60_000;

/** Tables that would otherwise grow forever. GitHub's redelivery window is at most a week. */
export async function prune(database: Database, now = Date.now()): Promise<void> {
  const { db } = database;
  await db.batch([
    db.delete(githubWebhookDeliveries).where(lt(githubWebhookDeliveries.receivedAt, new Date(now - 14 * DAY))),
    db.delete(githubManifestStates).where(lt(githubManifestStates.expiresAt, new Date(now - DAY))),
    db.delete(rateLimits).where(lt(rateLimits.lastRequest, now - DAY)),
  ]);
}
