import { createServer, type Socket } from "node:net";

import { openDatabase } from "@beekeeping/db";
import { createTestDatabase, type TestDatabase } from "@beekeeping/db/testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { database as appDatabase } from "./database.ts";
import { healthResponse } from "./health.ts";

describe("the health check", () => {
  let database: TestDatabase;
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(() => database.drop());

  it("answers 200 when the database answers", async () => {
    const handle = openDatabase(database.appUrl, { max: 1 });
    try {
      const response = await healthResponse(handle);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: "ok", database: "ok" });
    } finally {
      await handle.close();
    }
  });

  it("answers 503 when the app logs in as the database owner", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const handle = openDatabase(database.url, { max: 1 });
    try {
      const response = await healthResponse(handle);
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        status: "unavailable",
        database: "misconfigured",
      });
      expect(logged).toHaveBeenCalledOnce();
    } finally {
      logged.mockRestore();
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

  it("answers 503 within 4 s when the database accepts but never answers", async () => {
    // The pool the app opens, with its default limits.
    const sockets: Socket[] = [];
    const silent = createServer((socket) => void sockets.push(socket));
    await new Promise<void>((resolve) =>
      silent.listen(0, "127.0.0.1", resolve),
    );
    const address = silent.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const handle = openDatabase(`postgres://nobody@127.0.0.1:${port}/none`, {
      onError: () => {},
    });
    const started = performance.now();
    try {
      const response = await healthResponse(handle);
      expect(response.status).toBe(503);
      expect(performance.now() - started).toBeLessThan(4_000);
    } finally {
      for (const socket of sockets) socket.destroy();
      silent.close();
      void handle.close();
    }
  });

  it("answers 503, and logs no part of the URL, when DATABASE_URL can't be read", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    // stubEnv puts an unset variable back as unset. Assigning undefined to
    // process.env would store the text "undefined".
    vi.stubEnv("DATABASE_URL", "postgres://app:SecretPass9@[broken/books");
    try {
      const handle = appDatabase();
      expect(handle).toBeUndefined();
      expect((await healthResponse(handle)).status).toBe(503);
      expect(JSON.stringify(logged.mock.calls)).not.toContain("SecretPass9");
    } finally {
      vi.unstubAllEnvs();
      logged.mockRestore();
    }
  });

  it("says to use sslmode when DATABASE_URL has an ssl setting it refuses", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv(
      "DATABASE_URL",
      "postgres://app:SecretPass9@db.example.test/books?ssl=require",
    );
    try {
      expect(appDatabase()).toBeUndefined();
      const text = JSON.stringify(logged.mock.calls);
      expect(text).toContain("sslmode");
      expect(text).not.toContain("SecretPass9");
    } finally {
      vi.unstubAllEnvs();
      logged.mockRestore();
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
