import { readFileSync } from "node:fs";
import { join } from "node:path";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { openDatabase } from "./client.ts";
import { migrateDatabase, migrationsFolder } from "./migrate.ts";
import { adminQuery, databaseUrl, uniqueName } from "./testing/admin.ts";
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

/** The same server as url, signed in as another role. */
function asRole(url: string, role: string, password: string): string {
  const next = new URL(url);
  next.username = role;
  next.password = password;
  return next.toString();
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
    const url = asRole(databaseUrl(serverUrl, database), owner, password);
    await expect(migrateDatabase(url)).rejects.toThrow(
      /needs the right to switch to beekeeping_app/,
    );
  });

  it("migrates once a superuser grants it the app role", async () => {
    await adminQuery(serverUrl, `grant beekeeping_app to "${owner}"`);
    const url = asRole(databaseUrl(serverUrl, database), owner, password);
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
    const app = openDatabase(database.url);
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
});
