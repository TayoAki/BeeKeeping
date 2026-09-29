import { createServer, type Server, type Socket } from "node:net";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { openDatabase } from "./client.ts";
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

  it("answers ok from a running database, as the app role", async () => {
    const { pool, close } = openDatabase(database.url, { max: 1 });
    try {
      expect((await pingDatabase(pool)).ok).toBe(true);
    } finally {
      await close();
    }
  });

  it("reports unreachable, with no error text, when nothing listens", async () => {
    // Port 1 on this machine has no server, so the connection is refused.
    const { pool, close } = openDatabase(
      "postgres://nobody:secret@127.0.0.1:1/none",
      { max: 1, onError: () => {} },
    );
    try {
      expect(await pingDatabase(pool)).toEqual({
        ok: false,
        reason: "unreachable",
      });
    } finally {
      await close();
    }
  });

  describe("against a server that accepts connections but never answers", () => {
    let silent: Server;
    let port: number;
    const sockets = new Set<Socket>();
    beforeAll(async () => {
      silent = createServer((socket) => {
        sockets.add(socket);
      });
      await new Promise<void>((resolve) =>
        silent.listen(0, "127.0.0.1", resolve),
      );
      const address = silent.address();
      port = typeof address === "object" && address ? address.port : 0;
    });
    afterAll(() => {
      for (const socket of sockets) socket.destroy();
      return new Promise<void>((resolve) => silent.close(() => resolve()));
    });

    it("gives up within the timeout instead of hanging", async () => {
      const { pool } = openDatabase(
        `postgres://nobody@127.0.0.1:${port}/none`,
        {
          max: 1,
          onError: () => {},
        },
      );
      const started = performance.now();
      expect(await pingDatabase(pool, { timeoutMs: 300 })).toEqual({
        ok: false,
        reason: "unreachable",
      });
      expect(performance.now() - started).toBeLessThan(2_000);
      // The pool's own connection timeout frees the stuck slot later.
      void pool.end();
    });
  });
});

describe("a broken idle connection", () => {
  it("logs only its error code, never the connection details", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { pool, close } = openDatabase(
      "postgres://user:secret@db.example.test/books",
    );
    const error = Object.assign(
      new Error("terminating connection: user=user host=db.example.test"),
      { code: "57P01" },
    );
    pool.emit("error", error);
    expect(logged).toHaveBeenCalledWith(
      "database: an idle connection failed (57P01)",
    );
    expect(JSON.stringify(logged.mock.calls)).not.toContain("db.example.test");
    logged.mockRestore();
    void close();
  });
});
