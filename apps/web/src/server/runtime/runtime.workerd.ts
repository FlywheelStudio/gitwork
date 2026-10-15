import "server-only";
import type { Database } from "@gitwork/db";
import { openD1 } from "@gitwork/db/d1";
import { type EmailSender, cloudflareSender, parseFrom, unconfiguredSender } from "@gitwork/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";

/** Cloudflare Workers: the D1 binding named DB. Bindings are per request, so no caching here. */
export function getDatabase(): Database {
  return openD1(getCloudflareContext().env.DB);
}

export function getEnv(): Record<string, string | undefined> {
  return getCloudflareContext().env as unknown as Record<string, string | undefined>;
}

/** Cloudflare Email Service through the `EMAIL` binding. Fails closed otherwise. */
export function getEmailSender(): EmailSender {
  const env = getCloudflareContext().env;
  if (env.EMAIL_TRANSPORT === "cloudflare" && env.EMAIL) {
    return cloudflareSender(env.EMAIL, parseFrom(env.EMAIL_FROM ?? "Gitwork <no-reply@localhost>"));
  }
  return unconfiguredSender();
}
