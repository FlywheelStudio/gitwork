import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { openD1 } from "../src/d1";
import type { Database } from "../src/types";
import { databaseContract } from "./contract";
import { applyMigrationsToD1 } from "./migrations";

type Env = { DB: D1Database };

describe("D1 driver (workerd via wrangler)", () => {
  let proxy: Awaited<ReturnType<typeof getPlatformProxy<Env>>>;
  let database: Database;

  beforeAll(async () => {
    proxy = await getPlatformProxy<Env>({
      configPath: fileURLToPath(new URL("./wrangler.test.jsonc", import.meta.url)),
      persist: false,
    });
  });

  afterAll(async () => {
    await proxy?.dispose();
  });

  beforeEach(async () => {
    const binding = proxy.env.DB;
    await binding.exec("DROP TABLE IF EXISTS instance_settings");
    await applyMigrationsToD1(binding);
    database = openD1(binding);
  });

  it("runs on a real D1 binding, not a SQLite fallback", async () => {
    expect(database.driver).toBe("d1");
    // Inspect the client behind `database`, not the binding: a SQLite fallback must fail here.
    // Only a D1 client has `prepare().run()` returning `meta.served_by`.
    const client = (database.db as unknown as { $client: D1Database }).$client;
    const result = await client.prepare("SELECT 1 AS one").run();
    expect(typeof result.meta.served_by).toBe("string");
  });

  databaseContract(() => database);
});
