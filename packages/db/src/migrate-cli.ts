import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { migrateSqlite } from "./migrate";
import { openSqlite } from "./node";

// Usage: DATABASE_URL=file:.data/gitwork.sqlite pnpm --filter @gitwork/db migrate
const url = process.env.DATABASE_URL ?? "file:.data/gitwork.sqlite";
if (url.startsWith("file:")) mkdirSync(dirname(resolve(url.slice("file:".length))), { recursive: true });
await migrateSqlite(openSqlite(url));
console.log(`Migrated ${url}`);
