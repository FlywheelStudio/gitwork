import "server-only";
import type { Database } from "@gitwork/db";
import { openD1 } from "@gitwork/db/d1";
import { getCloudflareContext } from "@opennextjs/cloudflare";

/** Cloudflare Workers: the D1 binding named DB. Bindings are per request, so no caching here. */
export function getDatabase(): Database {
  return openD1(getCloudflareContext().env.DB);
}
