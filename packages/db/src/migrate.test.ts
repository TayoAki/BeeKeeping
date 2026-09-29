import { readFileSync } from "node:fs";
import { join } from "node:path";

import { sql } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { openDatabase } from "./client.ts";
import { migrateDatabase, migrationsFolder } from "./migrate.ts";
import {
  adminQuery,
  databaseUrl,
  uniqueName,
  withLogin,
} from "./testing/admin.ts";
import {
  createEmptyDatabase,
  createTestDatabase,
  type TestDatabase,
} from "./testing/test-database.ts";

async function query<Row extends Record<string, unknown>>(
  url: string,
  sql: string,
): Promise<Row[]> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return (await client.query<Row>(sql)).rows;
  } finally {
    await client.end();
  }
}

function journalTags(): string[] {
  const journal = JSON.parse(
    readFileSync(join(migrationsFolder, "meta/_journal.json"), "utf8"),
  ) as { entries: { tag: string }[] };
  return journal.entries.map(({ tag }) => tag);
}

/**
 * What Postgres said when work failed. Drizzle wraps it in an error whose
 * message is the failed SQL, so the message alone proves nothing.
 */
async function postgresError(
  work: Promise<unknown>,
): Promise<{ message: string; code?: string }> {
  try {
    await work;
  } catch (error) {
    return ((error as { cause?: unknown }).cause ?? error) as {
      message: string;
      code?: string;
    };
  }
  throw new Error("It didn't fail.");
}

describe("migrations", () => {
  let empty: TestDatabase;
  beforeAll(async () => {
    empty = await createEmptyDatabase();
  });
  afterAll(() => empty.drop());

  it("apply to an empty database, and a second run changes nothing", async () => {
    const applied = () =>
      query<{ hash: string }>(
        empty.url,
        "select hash from drizzle.__drizzle_migrations order by id",
      );

    await migrateDatabase(empty.url);
    const first = await applied();
    await migrateDatabase(empty.url);

    expect(first).toHaveLength(journalTags().length);
    expect(await applied()).toEqual(first);
  });

  it("apply once when several runs start at the same moment", async () => {
    const fresh = await createEmptyDatabase();
    try {
      await Promise.all([
        migrateDatabase(fresh.url),
        migrateDatabase(fresh.url),
        migrateDatabase(fresh.url),
      ]);
      const rows = await query(
        fresh.url,
        "select hash from drizzle.__drizzle_migrations",
      );
      expect(rows).toHaveLength(journalTags().length);
    } finally {
      await fresh.drop();
    }
  });

  it("refuse to run when beekeeping_app has another role's rights", async () => {
    const fresh = await createEmptyDatabase();
    const server = databaseUrl(fresh.url, "postgres");
    const other = uniqueName("bk_other");
    await adminQuery(server, `create role "${other}" nologin`);
    await adminQuery(server, `grant "${other}" to beekeeping_app`);
    try {
      const error = await postgresError(migrateDatabase(fresh.url));
      expect(error.message).toMatch(/or use another role's rights/);
    } finally {
      await adminQuery(server, `revoke "${other}" from beekeeping_app`);
      await adminQuery(server, `drop role "${other}"`);
      await fresh.drop();
    }
  });
});

describe("a migration owner that isn't a superuser", () => {
  const password = "owner-test-password";
  let serverUrl: string;
  let owner: string;
  let database: string;

  beforeAll(async () => {
    const template = await createTestDatabase();
    serverUrl = databaseUrl(template.url, "postgres");
    await template.drop();
    owner = uniqueName("bk_owner");
    database = uniqueName("bk_test");
    await adminQuery(
      serverUrl,
      `create role "${owner}" login password '${password}'`,
    );
    await adminQuery(
      serverUrl,
      `create database "${database}" owner "${owner}"`,
    );
  });

  afterAll(async () => {
    await adminQuery(
      serverUrl,
      `drop database if exists "${database}" with (force)`,
    );
    await adminQuery(serverUrl, `drop role if exists "${owner}"`);
  });

  it("gets a clear error when it can't switch to the app role", async () => {
    const url = withLogin(databaseUrl(serverUrl, database), owner, password);
    const error = await postgresError(migrateDatabase(url));
    expect(error.message).toBe(
      `The migration user ${owner} needs the right to switch to beekeeping_app. A superuser can run: GRANT beekeeping_app TO ${owner};`,
    );
  });

  it("migrates once a superuser grants it the app role", async () => {
    await adminQuery(serverUrl, `grant beekeeping_app to "${owner}"`);
    const url = withLogin(databaseUrl(serverUrl, database), owner, password);
    await migrateDatabase(url);
    const [row] = await query<{ can_set: boolean }>(
      url,
      `select pg_has_role(current_user, 'beekeeping_app', 'SET') as can_set`,
    );
    expect(row?.can_set).toBe(true);
    await adminQuery(serverUrl, `revoke beekeeping_app from "${owner}"`);
  });
});

describe("the beekeeping_app role", () => {
  let database: TestDatabase;
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(() => database.drop());

  it("can't log in, skip row-level security or act as a superuser", async () => {
    const [role] = await query(
      database.url,
      `select rolcanlogin, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole
         from pg_roles where rolname = 'beekeeping_app'`,
    );
    expect(role).toEqual({
      rolcanlogin: false,
      rolsuper: false,
      rolbypassrls: false,
      rolcreatedb: false,
      rolcreaterole: false,
    });
  });

  it("can read and write tables created later, but not truncate or own them", async () => {
    await query(database.url, "create table probe (id int)");
    const [access] = await query(
      database.url,
      `select has_table_privilege('beekeeping_app', 'probe', 'select') as select,
              has_table_privilege('beekeeping_app', 'probe', 'insert') as insert,
              has_table_privilege('beekeeping_app', 'probe', 'update') as update,
              has_table_privilege('beekeeping_app', 'probe', 'delete') as delete,
              has_table_privilege('beekeeping_app', 'probe', 'truncate') as truncate,
              pg_has_role('beekeeping_app', (select tableowner from pg_tables where tablename = 'probe'), 'member') as owns`,
    );
    expect(access).toEqual({
      select: true,
      insert: true,
      update: true,
      delete: true,
      truncate: false,
      owns: false,
    });
  });

  it("can use sequences created later", async () => {
    await query(database.url, "create sequence probe_seq");
    const [access] = await query(
      database.url,
      `select has_sequence_privilege('beekeeping_app', 'probe_seq', 'usage') as usage`,
    );
    expect(access).toEqual({ usage: true });
  });

  it("is who every app connection runs as, and it can't create tables", async () => {
    const app = openDatabase(database.appUrl);
    try {
      const result = await app.pool.query<{ current_user: string }>(
        "select current_user",
      );
      expect(result.rows[0]?.current_user).toBe("beekeeping_app");
      await expect(
        app.pool.query("create table sneaky (id int)"),
      ).rejects.toThrow(/permission denied/);
    } finally {
      await app.close();
    }
  });

  it("stays in charge when the URL brings options of its own", async () => {
    const url = new URL(database.appUrl);
    url.searchParams.set("options", "-c search_path=public");
    const app = openDatabase(url.toString(), { max: 1 });
    try {
      const { rows } = await app.pool.query<{
        current_user: string;
        search_path: string;
      }>("select current_user, current_setting('search_path') as search_path");
      expect(rows[0]).toEqual({
        current_user: "beekeeping_app",
        search_path: "public",
      });
    } finally {
      await app.close();
    }
  });

  it("leaves nothing to read when a connection drops the role", async () => {
    await query(database.url, "create table private_probe (id int)");
    const app = openDatabase(database.appUrl, { max: 1 });
    try {
      await app.pool.query("set role none");
      const error = await postgresError(
        app.pool.query("select * from private_probe"),
      );
      expect(error.code).toBe("42501");
    } finally {
      await app.close();
    }
  });

  it("has Postgres cancel a slow statement, leaving no transaction open", async () => {
    const app = openDatabase(database.appUrl, {
      max: 1,
      statementTimeoutMs: 200,
    });
    try {
      const error = await postgresError(
        app.db.transaction(async (tx) => {
          await tx.execute(sql`select set_config('app.org_id', '1', true)`);
          await tx.execute(sql`select pg_sleep(2)`);
        }),
      );
      expect(error.code).toBe("57014");
      // One connection, so this query runs on the one that timed out.
      const { rows } = await app.pool.query<{
        org: string | null;
        fresh: boolean;
      }>(
        "select current_setting('app.org_id', true) as org, now() = statement_timestamp() as fresh",
      );
      expect(rows[0]?.org ?? "").toBe("");
      expect(rows[0]?.fresh).toBe(true);
    } finally {
      await app.close();
    }
  });
});
