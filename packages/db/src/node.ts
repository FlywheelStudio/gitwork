import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";
import type { Database, Db } from "./types";

/**
 * Opens a SQLite file (or `:memory:`) through libsql. For Node hosts and tests.
 * `url` takes a libsql URL, e.g. `file:.data/gitwork.sqlite`.
 */
export function openSqlite(url: string): Database {
  const client = createClient({ url });
  return { driver: "sqlite", db: drizzle(client, { schema }) as unknown as Db };
}
