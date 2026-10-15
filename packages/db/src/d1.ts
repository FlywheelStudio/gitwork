import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";
import type { Database, Db } from "./types";

/** Opens the database on Cloudflare D1. Never imports a native module. */
export function openD1(binding: D1Database): Database {
  return { driver: "d1", db: drizzle(binding, { schema }) as unknown as Db };
}
