/**
 * Test-only helpers: open a fresh, migrated database on each driver.
 * Import from `@gitwork/db/testing` in tests only — it loads wrangler.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getPlatformProxy } from "wrangler";
import { openD1 } from "./d1";
import { MIGRATIONS_DIR, migrateSqlite } from "./migrate";
import { openSqlite } from "./node";
import type { Database } from "./types";

export interface TestDriver {
  name: "sqlite" | "d1";
  /** A fresh, fully migrated, empty database. */
  fresh(): Promise<Database>;
  dispose(): Promise<void>;
}

export function sqliteTestDriver(): TestDriver {
  return {
    name: "sqlite",
    async fresh() {
      const database = openSqlite(":memory:");
      await migrateSqlite(database);
      return database;
    },
    async dispose() {},
  };
}

type Env = { DB: D1Database };

export async function d1TestDriver(): Promise<TestDriver> {
  const proxy = await getPlatformProxy<Env>({
    configPath: fileURLToPath(new URL("../test/wrangler.test.jsonc", import.meta.url)),
    persist: false,
  });
  const binding = proxy.env.DB;
  return {
    name: "d1",
    async fresh() {
      await resetD1(binding);
      return openD1(binding);
    },
    dispose: () => proxy.dispose(),
  };
}

/** Both drivers, for `describe.each`. Call `dispose()` on each in `afterAll`. */
export async function allTestDrivers(): Promise<TestDriver[]> {
  return [sqliteTestDriver(), await d1TestDriver()];
}

async function resetD1(binding: D1Database): Promise<void> {
  const { results } = await binding
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'")
    .all<{ name: string }>();
  const drops = results.map((r) => binding.prepare(`DROP TABLE IF EXISTS "${r.name}"`));
  if (drops.length > 0) {
    await binding.batch([binding.prepare("PRAGMA defer_foreign_keys = ON"), ...drops]);
  }
  await applyMigrationsToD1(binding);
}

interface Journal {
  entries: { idx: number; tag: string }[];
}

/** Applies drizzle-kit migrations to a D1 binding in journal order, as `wrangler d1 migrations` does. */
export async function applyMigrationsToD1(binding: D1Database): Promise<void> {
  const journal = JSON.parse(readFileSync(join(MIGRATIONS_DIR, "meta/_journal.json"), "utf8")) as Journal;
  for (const entry of [...journal.entries].sort((a, b) => a.idx - b.idx)) {
    const statements = readFileSync(join(MIGRATIONS_DIR, `${entry.tag}.sql`), "utf8")
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);
    await binding.batch(statements.map((s) => binding.prepare(s)));
  }
}
