import { migrate } from "drizzle-orm/libsql/migrator";
import { fileURLToPath } from "node:url";
import type { Database } from "./types";

// Kept out of `./node`: bundlers try to resolve this URL as an asset.
export const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations", import.meta.url));

/** Applies all pending migrations to a SQLite database opened with `openSqlite`. */
export async function migrateSqlite(database: Database): Promise<void> {
  // The runtime object is a LibSQLDatabase; `Db` hides only `transaction`.
  await migrate(database.db as unknown as Parameters<typeof migrate>[0], { migrationsFolder: MIGRATIONS_DIR });
}
