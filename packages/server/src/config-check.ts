import { githubInstallations, githubWebhookDeliveries, instanceSettings, type Database } from "@gitwork/db";
import { count, desc, eq, isNull } from "drizzle-orm";

/** One problem with the instance configuration. Names the variable, never its value. */
export interface ConfigIssue {
  level: "error" | "warn";
  key: string;
  message: string;
}

export type RuntimeName = "node" | "workerd";

const GITHUB_KEYS = [
  "GITHUB_APP_ID",
  "GITHUB_APP_PRIVATE_KEY",
  "GITHUB_WEBHOOK_SECRET",
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
] as const;

/**
 * Checks the production configuration. An "error" stops sign-in or setup from working; a "warn"
 * works but is probably a mistake. Messages name variables only, so the result is safe to log and
 * to show an instance admin.
 */
export function checkConfig(env: Record<string, string | undefined>, runtime: RuntimeName): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const error = (key: string, message: string) => issues.push({ level: "error", key, message });
  const warn = (key: string, message: string) => issues.push({ level: "warn", key, message });

  const secret = env.BETTER_AUTH_SECRET ?? "";
  if (!secret) error("BETTER_AUTH_SECRET", "Not set. Generate one with: openssl rand -base64 32");
  else if (secret.length < 32) error("BETTER_AUTH_SECRET", "Shorter than 32 characters.");

  const url = parseUrl(env.BETTER_AUTH_URL);
  if (!env.BETTER_AUTH_URL) error("BETTER_AUTH_URL", "Not set. Use the public URL of this instance.");
  else if (!url) error("BETTER_AUTH_URL", "Not an http(s) URL.");
  else if (url.protocol === "http:" && !isLocal(url.hostname)) {
    warn("BETTER_AUTH_URL", "Uses http. Sign-in cookies and GitHub webhooks need https in production.");
  }

  if (!env.INSTANCE_ADMIN_EMAILS?.trim()) {
    error("INSTANCE_ADMIN_EMAILS", "Not set. Nobody can open /setup or create the first account.");
  }

  const transport = env.EMAIL_TRANSPORT ?? "";
  if (runtime === "workerd") {
    if (transport !== "cloudflare") error("EMAIL_TRANSPORT", 'Must be "cloudflare" on Workers.');
  } else if (transport === "smtp") {
    if (!env.SMTP_URL) error("SMTP_URL", 'Not set, but EMAIL_TRANSPORT is "smtp".');
  } else if (transport === "outbox") {
    warn("EMAIL_TRANSPORT", '"outbox" writes sign-in codes to a file. Use it for tests only.');
  } else {
    error("EMAIL_TRANSPORT", 'Must be "smtp" on Node hosts. Nobody can sign in without email.');
  }
  if (!env.EMAIL_FROM) warn("EMAIL_FROM", "Not set. Sign-in emails come from no-reply@localhost.");

  const set = GITHUB_KEYS.filter((key) => env[key]);
  if (set.length > 0 && set.length < GITHUB_KEYS.length) {
    const missing = GITHUB_KEYS.filter((key) => !env[key]);
    error(missing.join(", "), "Set all five GitHub App variables, or none and use /setup.");
  }

  if (runtime === "node") {
    if (!env.DATABASE_URL) warn("DATABASE_URL", "Not set. Using file:.data/gitwork.sqlite in the working directory.");
    const scheduler = env.GITWORK_SCHEDULER;
    if (scheduler && scheduler !== "off") warn("GITWORK_SCHEDULER", 'Only "off" has a meaning. Leave it empty to reconcile.');
  }
  return issues;
}

function parseUrl(value: string | undefined): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function isLocal(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname.endsWith(".localhost");
}

export interface InstanceHealth {
  issues: ConfigIssue[];
  driver: string;
  installations: number;
  lastWebhookAt: Date | null;
  lastReconcile: { at: string; status: string; message?: string } | null;
}

/** What the admin health page shows. Reads the database only; no GitHub calls. */
export async function instanceHealth(
  database: Database,
  env: Record<string, string | undefined>,
  runtime: RuntimeName,
): Promise<InstanceHealth> {
  const { db } = database;
  const [installs] = await db.select({ n: count() }).from(githubInstallations).where(isNull(githubInstallations.deletedAt));
  const [hook] = await db
    .select({ at: githubWebhookDeliveries.receivedAt })
    .from(githubWebhookDeliveries)
    .orderBy(desc(githubWebhookDeliveries.receivedAt))
    .limit(1);
  const [run] = await db
    .select({ value: instanceSettings.value })
    .from(instanceSettings)
    .where(eq(instanceSettings.key, "reconcile_last_run"));
  return {
    issues: checkConfig(env, runtime),
    driver: database.driver,
    installations: installs?.n ?? 0,
    lastWebhookAt: hook?.at ?? null,
    lastReconcile: run ? parseRun(run.value) : null,
  };
}

function parseRun(value: string): InstanceHealth["lastReconcile"] {
  try {
    const run = JSON.parse(value) as { at?: unknown; status?: unknown; message?: unknown };
    if (typeof run.at !== "string" || typeof run.status !== "string") return null;
    return { at: run.at, status: run.status, ...(typeof run.message === "string" ? { message: run.message } : {}) };
  } catch {
    return null;
  }
}
