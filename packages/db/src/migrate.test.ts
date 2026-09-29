import { readFileSync } from "node:fs";
import { join } from "node:path";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { migrateDatabase, migrationsFolder } from "./migrate.ts";
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

  it("can read and write tables created later, but not truncate or drop them", async () => {
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

  it("is a role the migration user can switch to", async () => {
    const client = new pg.Client({ connectionString: database.url });
    await client.connect();
    try {
      await client.query("begin");
      await client.query("set local role beekeeping_app");
      const result = await client.query<{ current_user: string }>(
        "select current_user",
      );
      await client.query("rollback");
      expect(result.rows[0]?.current_user).toBe("beekeeping_app");
    } finally {
      await client.end();
    }
  });
});
