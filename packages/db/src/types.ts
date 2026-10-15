import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import type * as schema from "./schema";

export type Schema = typeof schema;

/**
 * The one database type the app uses, on D1 and on a SQLite file.
 * Both drivers are async. `batch` is the only atomic multi-statement write:
 * D1 has no interactive transactions, so code must not use `transaction()`.
 */
export type Db = Omit<BaseSQLiteDatabase<"async", unknown, Schema>, "transaction"> &
  Pick<DrizzleD1Database<Schema>, "batch">;

export type DriverName = "d1" | "sqlite";

export interface Database {
  driver: DriverName;
  db: Db;
}
