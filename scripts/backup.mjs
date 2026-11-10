// Online backup of the SQLite database, safe while Gitwork runs (VACUUM INTO).
// The Docker image ships this as /app/backup.mjs:
//   docker compose exec gitwork node backup.mjs /data/backup.sqlite
// Reads DATABASE_URL (file:...). Refuses to overwrite an existing file.
import { existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const target = process.argv[2];
if (!target) {
  console.error("usage: node backup.mjs <target.sqlite>");
  process.exit(2);
}
if (existsSync(target)) {
  console.error(`${target} exists; choose a new name`);
  process.exit(1);
}
const url = process.env.DATABASE_URL ?? "file:/data/gitwork.sqlite";
// The standalone server keeps the libsql client under node_modules/.pnpm.
const store = fileURLToPath(new URL("./node_modules/.pnpm/", import.meta.url));
const dir = readdirSync(store).find((name) => name.startsWith("@libsql+client@"));
if (!dir) {
  console.error(`no @libsql/client under ${store}`);
  process.exit(1);
}
const require = createRequire(import.meta.url);
const { createClient } = require(`${store}${dir}/node_modules/@libsql/client`);
await createClient({ url }).execute({ sql: "VACUUM INTO ?", args: [target] });
console.log(`backed up ${url} to ${target}`);
