import "server-only";
import type { Database } from "@gitwork/db";
import { openSqlite } from "@gitwork/db/node";

let database: Database | undefined;

/** Node hosts: a SQLite file through libsql. `pnpm db:migrate` creates and migrates it. */
export function getDatabase(): Database {
  database ??= openSqlite(process.env.DATABASE_URL ?? "file:.data/gitwork.sqlite");
  return database;
}
