/**
 * Light entry for the scheduled reconcile (Worker cron and Node timer): no Better Auth, no email.
 */
import { type Database, instanceSettings } from "@gitwork/db";
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
        const result = await reconcile({ db: database.db, client, holder });
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
  const value = JSON.stringify(run);
  await database.db
    .insert(instanceSettings)
    .values({ key: "reconcile_last_run", value })
    .onConflictDoUpdate({ target: instanceSettings.key, set: { value, updatedAt: new Date() } });
  return run;
}
