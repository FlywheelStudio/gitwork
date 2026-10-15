import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type TestDriver, d1TestDriver } from "../src/testing";
import type { Database } from "../src/types";
import { constraintContract, databaseContract } from "./contract";

describe("D1 driver (workerd via wrangler)", () => {
  let driver: TestDriver;
  let database: Database;

  beforeAll(async () => {
    driver = await d1TestDriver();
  });
  afterAll(() => driver?.dispose());
  beforeEach(async () => {
    database = await driver.fresh();
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
  constraintContract(() => database);
});
