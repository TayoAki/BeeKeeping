import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { pingDatabase } from "./health.ts";
import {
  createTestDatabase,
  type TestDatabase,
} from "./testing/test-database.ts";

describe("pingDatabase", () => {
  let database: TestDatabase;
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(() => database.drop());

  it("answers ok from a running database", async () => {
    const pool = new pg.Pool({ connectionString: database.url, max: 1 });
    try {
      const result = await pingDatabase(pool);
      expect(result.ok).toBe(true);
    } finally {
      await pool.end();
    }
  });

  it("reports unreachable, with no error text, when nothing answers", async () => {
    // Port 1 on this machine has no server, so the connection is refused.
    const pool = new pg.Pool({
      connectionString: "postgres://nobody:secret@127.0.0.1:1/none",
      max: 1,
      connectionTimeoutMillis: 2000,
    });
    try {
      expect(await pingDatabase(pool)).toEqual({
        ok: false,
        reason: "unreachable",
      });
    } finally {
      await pool.end();
    }
  });
});
