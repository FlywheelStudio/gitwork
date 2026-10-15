import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MIGRATIONS_DIR } from "../src/migrate";

interface Journal {
  entries: { idx: number; tag: string }[];
}

/** Applies drizzle-kit migrations to a D1 binding, in journal order. Test helper only. */
export async function applyMigrationsToD1(binding: D1Database): Promise<void> {
  const journal = JSON.parse(readFileSync(join(MIGRATIONS_DIR, "meta/_journal.json"), "utf8")) as Journal;
  for (const entry of [...journal.entries].sort((a, b) => a.idx - b.idx)) {
    const sqlText = readFileSync(join(MIGRATIONS_DIR, `${entry.tag}.sql`), "utf8");
    const statements = sqlText
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);
    await binding.batch(statements.map((s) => binding.prepare(s)));
  }
}
