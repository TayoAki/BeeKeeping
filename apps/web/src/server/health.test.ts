import { openDatabase } from "@beekeeping/db";
import { createTestDatabase, type TestDatabase } from "@beekeeping/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { healthResponse } from "./health.ts";

describe("the health check", () => {
  let database: TestDatabase;
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(() => database.drop());

  it("answers 200 when the database answers", async () => {
    const handle = openDatabase(database.url, { max: 1 });
    try {
      const response = await healthResponse(handle);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: "ok", database: "ok" });
    } finally {
      await handle.close();
    }
  });

  it("answers 503 without details when the database doesn't", async () => {
    const handle = openDatabase("postgres://nobody:secret@127.0.0.1:1/none", {
      max: 1,
      onError: () => {},
    });
    try {
      const response = await healthResponse(handle);
      expect(response.status).toBe(503);
      const text = await response.text();
      expect(JSON.parse(text)).toEqual({
        status: "unavailable",
        database: "unreachable",
      });
      expect(text).not.toContain("secret");
    } finally {
      await handle.close();
    }
  });

  it("answers 503 when no database is configured", async () => {
    const response = await healthResponse(undefined);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: "unavailable",
      database: "not_configured",
    });
  });
});
