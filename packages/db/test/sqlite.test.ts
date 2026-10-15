import { beforeEach, describe, expect, it } from "vitest";
import { sqliteTestDriver } from "../src/testing";
import type { Database } from "../src/types";
import { constraintContract, databaseContract } from "./contract";

describe("SQLite file driver (libsql)", () => {
  let database: Database;

  beforeEach(async () => {
    database = await sqliteTestDriver().fresh();
  });

  it("reports the sqlite driver", () => {
    expect(database.driver).toBe("sqlite");
  });

  databaseContract(() => database);
  constraintContract(() => database);
});
