import { createServer, type Server, type Socket } from "node:net";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { randomBytes } from "node:crypto";

import pg from "pg";

import { openDatabase } from "./client.ts";
import { pingDatabase } from "./health.ts";
import {
  adminQuery,
  databaseUrl,
  uniqueName,
  withLogin,
} from "./testing/admin.ts";
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
    const { pool, close } = openDatabase(database.appUrl, { max: 1 });
    try {
      expect((await pingDatabase(pool)).ok).toBe(true);
      const { rows } = await pool.query<{ current_user: string }>(
        "select current_user",
      );
      expect(rows[0]?.current_user).toBe("beekeeping_app");
    } finally {
      await close();
    }
  });

  it("reports an unsafe role when the app logs in as the database owner", async () => {
    const { pool, close } = openDatabase(database.url, { max: 1 });
    try {
      expect(await pingDatabase(pool)).toEqual({
        ok: false,
        reason: "unsafe_role",
      });
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

describe("the role check, for a login that can do more than the app", () => {
  let database: TestDatabase;
  let server: string;
  const made: string[] = [];

  beforeAll(async () => {
    database = await createTestDatabase();
    server = databaseUrl(database.url, "postgres");
  });
  afterAll(async () => {
    const name = new URL(database.url).pathname.slice(1);
    await adminQuery(server, `alter database "${name}" owner to current_user`);
    await database.drop();
    for (const role of made.reverse()) {
      await adminQuery(server, `drop role if exists "${role}"`);
    }
  });

  /** A login that can switch to beekeeping_app, with extra rights. */
  async function login(extra: string, grants: string[] = []) {
    const user = uniqueName("bk_login");
    const password = randomBytes(12).toString("hex");
    await adminQuery(
      server,
      `create role "${user}" login noinherit ${extra} password '${password}'`,
    );
    made.push(user);
    await adminQuery(
      server,
      `grant ${["beekeeping_app", ...grants].join(", ")} to "${user}"`,
    );
    return { user, url: withLogin(database.url, user, password) };
  }

  async function ping(url: string) {
    const { pool, close } = openDatabase(url, { max: 1 });
    try {
      return await pingDatabase(pool);
    } finally {
      await close();
    }
  }

  it("passes a login that can only switch to beekeeping_app", async () => {
    const { url } = await login("");
    expect((await ping(url)).ok).toBe(true);
  });

  it("fails a login that skips row-level security", async () => {
    const { url } = await login("bypassrls");
    expect(await ping(url)).toEqual({ ok: false, reason: "unsafe_role" });
  });

  it("fails a login that owns the database", async () => {
    const { user, url } = await login("");
    const name = new URL(database.url).pathname.slice(1);
    await adminQuery(server, `alter database "${name}" owner to "${user}"`);
    try {
      expect(await ping(url)).toEqual({ ok: false, reason: "unsafe_role" });
    } finally {
      await adminQuery(
        server,
        `alter database "${name}" owner to current_user`,
      );
    }
  });

  it("fails a pool that doesn't start as beekeeping_app", async () => {
    const { url } = await login("");
    // A plain pool never sets the role, so it runs as the bare login.
    const pool = new pg.Pool({ connectionString: url, max: 1 });
    try {
      expect(await pingDatabase(pool)).toEqual({
        ok: false,
        reason: "unsafe_role",
      });
    } finally {
      await pool.end();
    }
  });

  it("fails a login that can switch to another role", async () => {
    const other = uniqueName("bk_other");
    await adminQuery(server, `create role "${other}" nologin`);
    made.push(other);
    const { url } = await login("", [`"${other}"`]);
    expect(await ping(url)).toEqual({ ok: false, reason: "unsafe_role" });
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
