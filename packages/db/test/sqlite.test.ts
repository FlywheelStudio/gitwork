import { beforeEach, describe, expect, it } from "vitest";
import { migrateSqlite } from "../src/migrate";
import { openSqlite } from "../src/node";
import type { Database } from "../src/types";
import { databaseContract } from "./contract";

describe("SQLite file driver (libsql)", () => {
  let database: Database;

  beforeEach(async () => {
    database = openSqlite(":memory:");
    await migrateSqlite(database);
  });

  it("reports the sqlite driver", () => {
    expect(database.driver).toBe("sqlite");
  });

  databaseContract(() => database);
});
