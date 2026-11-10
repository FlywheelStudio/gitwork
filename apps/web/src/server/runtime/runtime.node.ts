import "server-only";
import type { Database } from "@gitwork/db";
import { openSqlite } from "@gitwork/db/node";
import { migrate } from "drizzle-orm/libsql/migrator";
import { type EmailSender, type RuntimeName, checkConfig, consoleSender, unconfiguredSender } from "@gitwork/server";
import { outboxSender, smtpSender } from "@gitwork/server/email-node";
import { runScheduledReconcile } from "@gitwork/server/sync";

let database: Database | undefined;

/** Node hosts: a SQLite file through libsql. `pnpm db:migrate` creates and migrates it. */
export function getDatabase(): Database {
  database ??= openSqlite(process.env.DATABASE_URL ?? "file:.data/gitwork.sqlite");
  return database;
}

/** Node hosts get no client IP from infrastructure unless a proxy sets TRUSTED_IP_HEADER. */
export const DEFAULT_TRUSTED_IP_HEADER: string | undefined = undefined;

export function getEnv(): Record<string, string | undefined> {
  return process.env;
}

/** Fails closed: production never falls back to printing sign-in codes to the log. */
export function getEmailSender(): EmailSender {
  // wrangler's generated types narrow process.env to the Worker's vars; on Node any value is possible.
  const env: Record<string, string | undefined> = process.env;
  const transport = env.EMAIL_TRANSPORT ?? (env.NODE_ENV === "development" ? "console" : "");
  const from = env.EMAIL_FROM ?? "Gitwork <no-reply@localhost>";
  if (transport === "smtp" && env.SMTP_URL) return smtpSender(env.SMTP_URL, from);
  if (transport === "outbox") return outboxSender(env.EMAIL_OUTBOX_PATH ?? ".data/outbox.jsonl");
  if (transport === "console" && env.NODE_ENV !== "production") return consoleSender();
  return unconfiguredSender();
}

const RECONCILE_EVERY_MS = 15 * 60_000;
const scheduler = globalThis as { __gitworkScheduler?: ReturnType<typeof setInterval> };

/**
 * Node hosts: reconcile every 15 minutes in-process (decision 010). Several instances are safe:
 * the reconcile lease lets one run at a time. GITWORK_SCHEDULER=off disables it.
 */
export function startScheduler(): void {
  if (scheduler.__gitworkScheduler || process.env.GITWORK_SCHEDULER === "off") return;
  const holder = `node-${process.pid}-${crypto.randomUUID()}`;
  const tick = () =>
    void runScheduledReconcile(getDatabase(), process.env, holder).then((run) => {
      if (run.status !== "skipped") console.info(`[reconcile] ${JSON.stringify(run)}`);
    });
  scheduler.__gitworkScheduler = setInterval(tick, RECONCILE_EVERY_MS);
  setTimeout(tick, 30_000);
}

export const RUNTIME: RuntimeName = "node";

/**
 * Runs once before the server takes requests (src/instrumentation.ts). Production only:
 * 1. Logs every configuration problem by variable name. With GITWORK_FAIL_ON_CONFIG_ERROR=1 (the
 *    Docker image sets it) an error stops the process, so a bad deploy fails loudly at boot.
 * 2. With GITWORK_MIGRATIONS_DIR set (the Docker image sets it), applies pending migrations.
 */
export async function bootNode(): Promise<void> {
  if (process.env.NODE_ENV !== "production") return;
  const issues = checkConfig(process.env, RUNTIME);
  for (const issue of issues) console[issue.level === "error" ? "error" : "warn"](`[config] ${issue.level}: ${issue.key}: ${issue.message}`);
  if (process.env.GITWORK_FAIL_ON_CONFIG_ERROR === "1" && issues.some((i) => i.level === "error")) {
    console.error("[config] Fix the errors above, then restart. See .env.example.");
    process.exit(1);
  }
  const dir = process.env.GITWORK_MIGRATIONS_DIR;
  if (dir) {
    // The runtime object is a LibSQLDatabase; `Db` hides only `transaction`.
    await migrate(getDatabase().db as unknown as Parameters<typeof migrate>[0], { migrationsFolder: dir });
    console.info(`[db] migrations applied from ${dir}`);
  }
}
