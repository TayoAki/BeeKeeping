// The audit log: the triggers copy only the fields a table lists, name the
// person from app.user_id, and nobody can change what they wrote. Each
// table with org_id must have a trigger, so a table added later without
// one fails here.
import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createTestDatabase,
  postgresError,
  type TestDatabase,
} from "./testing/test-database.ts";

let database: TestDatabase;
let owner: pg.Client;
let app: pg.Client;

type Event = {
  table_name: string;
  record_id: string;
  action: string;
  actor_user_id: string | null;
  changes: Record<string, unknown>;
};

beforeAll(async () => {
  database = await createTestDatabase();
  owner = new pg.Client({ connectionString: database.url });
  await owner.connect();
  app = new pg.Client({ connectionString: database.appUrl });
  await app.connect();
  // A table with a secret field, audited without it, as a migration would
  // make one.
  await owner.query(`
    create table vault_test (
      id uuid primary key default gen_random_uuid(),
      org_id uuid not null,
      label text not null,
      api_secret text not null
    );
    alter table vault_test enable row level security;
    create policy vault_test_org_isolation on vault_test for all to beekeeping_app
      using (org_id = (select current_org_id()))
      with check (org_id = (select current_org_id()));
    create trigger vault_test_audit after insert or update or delete on vault_test
      for each row execute function audit_row('id', 'label')`);
});
afterAll(async () => {
  await app.end();
  await owner.end();
  await database.drop();
});

/** Runs SQL as the app does: its role, one organization, one person. */
async function asApp(
  orgId: string,
  userId: string | undefined,
  text: string,
  values: unknown[] = [],
) {
  await app.query("begin");
  try {
    await app.query("select set_config('app.org_id', $1, true)", [orgId]);
    if (userId) {
      await app.query("select set_config('app.user_id', $1, true)", [userId]);
    }
    await app.query("set local role beekeeping_app");
    const result = await app.query(text, values);
    await app.query("commit");
    return result;
  } catch (error) {
    await app.query("rollback");
    throw error;
  }
}

async function eventsOf(orgId: string): Promise<Event[]> {
  return (
    await owner.query<Event>(
      `select table_name, record_id, action, actor_user_id, changes
         from audit_events where org_id = $1 order by occurred_at, seq`,
      [orgId],
    )
  ).rows;
}

describe("the audit log", () => {
  it("has a working trigger on every table with org_id but itself", async () => {
    // Enabled, AFTER, FOR EACH ROW, on INSERT, UPDATE and DELETE (tgtype
    // 1 + 4 + 8 + 16), on every column rather than UPDATE OF a list, and
    // with no WHEN condition that could skip rows.
    const { rows } = await owner.query<{ table: string; audited: boolean }>(`
      select c.relname as table,
             exists (select from pg_trigger t
                      where t.tgrelid = c.oid and not t.tgisinternal
                        and t.tgfoid = 'audit_row'::regproc
                        and t.tgenabled in ('O', 'A')
                        and t.tgtype = 29
                        and t.tgattr = ''::int2vector
                        and t.tgqual is null) as audited
        from pg_class c
       where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
         and exists (select from pg_attribute a where a.attrelid = c.oid
                      and a.attname = 'org_id' and not a.attisdropped)
         and c.relname not in ('audit_events', 'vault_test')
       order by 1`);
    expect(rows.map(({ table }) => table)).toContain("organization_settings");
    expect(rows.filter(({ audited }) => !audited)).toEqual([]);
  });

  it("copies only the fields a table lists, and names the person", async () => {
    const orgId = randomUUID();
    const userId = randomUUID();
    const { rows } = await asApp(
      orgId,
      userId,
      "insert into vault_test (org_id, label, api_secret) values ($1, 'Payments (demo)', 'secret one') returning id",
      [orgId],
    );
    const id = (rows[0] as { id: string }).id;
    await asApp(
      orgId,
      userId,
      "update vault_test set label = 'Payments, renamed (demo)', api_secret = 'secret two' where id = $1",
      [id],
    );
    await asApp(orgId, userId, "delete from vault_test where id = $1", [id]);
    expect(await eventsOf(orgId)).toEqual([
      {
        table_name: "vault_test",
        record_id: id,
        action: "insert",
        actor_user_id: userId,
        changes: { label: "Payments (demo)" },
      },
      {
        table_name: "vault_test",
        record_id: id,
        action: "update",
        actor_user_id: userId,
        changes: { label: ["Payments (demo)", "Payments, renamed (demo)"] },
      },
      {
        table_name: "vault_test",
        record_id: id,
        action: "delete",
        actor_user_id: userId,
        changes: { label: "Payments, renamed (demo)" },
      },
    ]);
  });

  it("leaves nothing for a change to a field the table doesn't list", async () => {
    const orgId = randomUUID();
    const { rows } = await asApp(
      orgId,
      randomUUID(),
      "insert into vault_test (org_id, label, api_secret) values ($1, 'Payroll (demo)', 'secret one') returning id",
      [orgId],
    );
    const id = (rows[0] as { id: string }).id;
    await asApp(
      orgId,
      randomUUID(),
      "update vault_test set api_secret = 'secret two' where id = $1",
      [id],
    );
    const events = await eventsOf(orgId);
    expect(events.map(({ action }) => action)).toEqual(["insert"]);
    expect(JSON.stringify(events)).not.toContain("secret");
  });

  it("names no one when no person acted", async () => {
    const orgId = randomUUID();
    await asApp(
      orgId,
      undefined,
      "insert into vault_test (org_id, label, api_secret) values ($1, 'Imports (demo)', 'secret')",
      [orgId],
    );
    expect((await eventsOf(orgId))[0]?.actor_user_id).toBeNull();
  });

  it("shows the app its own organization's events, and lets it change none", async () => {
    const mine = randomUUID();
    const theirs = randomUUID();
    for (const orgId of [mine, theirs]) {
      await asApp(
        orgId,
        randomUUID(),
        "insert into vault_test (org_id, label, api_secret) values ($1, 'Bank feed (demo)', 'secret')",
        [orgId],
      );
    }
    const { rows } = await asApp(
      mine,
      randomUUID(),
      "select org_id from audit_events",
    );
    expect(rows).toEqual([{ org_id: mine }]);
    for (const statement of [
      "update audit_events set changes = '{}'",
      "delete from audit_events",
      "truncate audit_events",
      `insert into audit_events (org_id, table_name, record_id, action, changes)
         values (current_org_id(), 'vault_test', 'x', 'insert', '{}')`,
    ]) {
      const error = await postgresError(asApp(mine, randomUUID(), statement));
      expect(error.code, statement).toBe("42501");
    }
  });

  it("won't let the app attach the trigger function to a table of its own", async () => {
    // audit_row runs as the owner and takes the organization from the row,
    // so a role that could attach it to a temp table could write any
    // organization's log, naming anyone.
    const error = await postgresError(
      asApp(
        randomUUID(),
        randomUUID(),
        `create temp table forged (id uuid primary key, org_id uuid not null, label text) on commit drop;
         create trigger forged_audit after insert on forged
           for each row execute function public.audit_row('id', 'label')`,
      ),
    );
    expect(error.code).toBe("42501");
  });

  it("can't be changed by the owner either", async () => {
    const orgId = randomUUID();
    await asApp(
      orgId,
      randomUUID(),
      "insert into vault_test (org_id, label, api_secret) values ($1, 'Payouts (demo)', 'secret')",
      [orgId],
    );
    for (const statement of [
      "update audit_events set changes = '{}'",
      "delete from audit_events",
      "truncate audit_events",
    ]) {
      const error = await postgresError(owner.query(statement));
      expect(error, statement).toMatchObject({
        code: "42501",
        message: "The audit log never changes.",
      });
    }
    expect(await eventsOf(orgId)).toHaveLength(1);
  });

  it("refuses a trigger attached the wrong way, rather than log wrongly", async () => {
    await owner.query(`
      create table misuse_test (id uuid primary key, org_id uuid, label text);
      create table no_org_test (id uuid primary key, label text)`);
    const insert = (table: string) =>
      table === "no_org_test"
        ? "insert into no_org_test values (gen_random_uuid(), 'x')"
        : "insert into misuse_test values (gen_random_uuid(), gen_random_uuid(), 'x')";
    for (const [trigger, table, message] of [
      [
        "before insert on misuse_test for each row execute function audit_row('id', 'label')",
        "misuse_test",
        "The audit trigger on misuse_test must run AFTER, FOR EACH ROW.",
      ],
      [
        "after insert on misuse_test for each statement execute function audit_row('id', 'label')",
        "misuse_test",
        "The audit trigger on misuse_test must run AFTER, FOR EACH ROW.",
      ],
      [
        "after insert on misuse_test for each row execute function audit_row('idd', 'label')",
        "misuse_test",
        "The audit trigger on misuse_test needs the table's key column first.",
      ],
      [
        "after insert on no_org_test for each row execute function audit_row('id', 'label')",
        "no_org_test",
        "The audit trigger on no_org_test needs a table with org_id.",
      ],
    ] as const) {
      await owner.query(`create trigger misuse_audit ${trigger}`);
      const error = await postgresError(owner.query(insert(table)));
      expect(error.message, trigger).toBe(message);
      await owner.query(`drop trigger misuse_audit on ${table}`);
    }
    await owner.query("drop table misuse_test, no_org_test");
  });

  it("refuses a trigger that lists a field its table doesn't have", async () => {
    await owner.query(`
      create table typo_test (id uuid primary key, org_id uuid not null, label text);
      create trigger typo_test_audit after insert on typo_test
        for each row execute function audit_row('id', 'lable')`);
    const error = await postgresError(
      owner.query(
        "insert into typo_test values (gen_random_uuid(), gen_random_uuid(), 'x')",
      ),
    );
    expect(error.message).toBe(
      "The audit trigger on typo_test lists lable, which it doesn't have.",
    );
    await owner.query("drop table typo_test");
  });
});
