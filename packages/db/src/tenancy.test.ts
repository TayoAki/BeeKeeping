// Checks every table in the catalog, so a table added later without its
// row-level security fails here. A table that holds organizations' data has
// org_id and the org isolation policy for the app's role. Every other table
// is sign-in's, for Better Auth's role alone. A view runs as its owner, who
// skips row-level security, so the app's roles may read only a view that
// runs as its caller, and never a materialized view or a foreign table.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createTestDatabase,
  type TestDatabase,
} from "./testing/test-database.ts";

type Relation = {
  name: string;
  kind: string;
  rls: boolean;
  hasOrgId: boolean;
  owner: string;
  invoker: boolean;
};
type Policy = {
  table: string;
  permissive: "PERMISSIVE" | "RESTRICTIVE";
  roles: string[];
  qual: string | null;
  with_check: string | null;
};

const appRoles = ["beekeeping_app", "beekeeping_auth"];

let database: TestDatabase;
let tables: Relation[];
let policies: Policy[];

async function query<Row extends Record<string, unknown>>(
  text: string,
): Promise<Row[]> {
  const client = new pg.Client({ connectionString: database.url });
  await client.connect();
  try {
    return (await client.query<Row>(text)).rows;
  } finally {
    await client.end();
  }
}

async function canTouch(role: string, table: string): Promise<boolean> {
  // Column grants count too: a view granted column by column skips
  // row-level security as much as one granted whole. TRUNCATE skips it on
  // any table.
  const target = `'${role}', 'public.${table}'`;
  const [row] = await query<{ any: boolean }>(
    `select has_any_column_privilege(${target}, 'select, insert, update')
            or has_table_privilege(${target}, 'delete, truncate') as any`,
  );
  return row?.any === true;
}

/** Every relation in public that a query can read rows from. */
function readRelations(): Promise<Relation[]> {
  return query<Relation>(`
    select c.relname as name, c.relkind::text as kind, c.relrowsecurity as rls,
           pg_get_userbyid(c.relowner) as owner,
           exists (select from unnest(coalesce(c.reloptions, '{}')) option
                    where option ~* '^security_invoker=(true|on|yes|1)$') as invoker,
           exists (select from pg_attribute a
                   where a.attrelid = c.oid and a.attname = 'org_id' and not a.attisdropped) as "hasOrgId"
      from pg_class c
     where c.relnamespace = 'public'::regnamespace
       and c.relkind in ('r', 'p', 'v', 'm', 'f')
     order by c.relname`);
}

/**
 * The views, materialized views and foreign tables one of the app's roles
 * can read although row-level security doesn't cover them, as
 * "relation, role".
 */
async function readableWithoutRowSecurity(
  relations: Relation[],
): Promise<string[]> {
  const found: string[] = [];
  for (const relation of relations) {
    if (relation.kind === "r" || relation.kind === "p") continue;
    if (relation.kind === "v" && relation.invoker) continue;
    for (const role of appRoles) {
      if (await canTouch(role, relation.name)) {
        found.push(`${relation.name}, ${role}`);
      }
    }
  }
  return found;
}

beforeAll(async () => {
  database = await createTestDatabase();
  tables = (await readRelations()).filter(
    (relation) => relation.kind === "r" || relation.kind === "p",
  );
  policies = await query<Policy>(`
    select tablename as table, permissive, roles::text[] as roles, qual, with_check
      from pg_policies where schemaname = 'public'`);
});
afterAll(() => database.drop());

describe("row-level security", () => {
  it("is on for every table", () => {
    expect(tables.length).toBeGreaterThan(0);
    expect(tables.filter((table) => !table.rls).map((t) => t.name)).toEqual([]);
  });

  it("gives the app one organization's rows of each table with org_id", async () => {
    const scoped = tables.filter((table) => table.hasOrgId);
    expect(scoped.map((table) => table.name)).toContain(
      "organization_settings",
    );
    // Each policy that lets rows through keeps to the organization. A
    // restrictive one may narrow that further, and only by hiding a table
    // from agents, as peopleOnly does.
    const clauses = {
      PERMISSIVE:
        /^\(org_id = \( SELECT current_org_id\(\) AS current_org_id\)\)$/,
      RESTRICTIVE:
        /^\(\( SELECT current_agent_id\(\) AS current_agent_id\) IS NULL\)$/,
    };
    for (const table of scoped) {
      const own = policies.filter((policy) => policy.table === table.name);
      expect(
        own.filter((policy) => policy.permissive === "PERMISSIVE"),
        table.name,
      ).toHaveLength(1);
      for (const policy of own) {
        expect(policy.roles, table.name).toEqual(["beekeeping_app"]);
        for (const clause of [policy.qual, policy.with_check]) {
          expect(clause, `${table.name} ${policy.permissive}`).toMatch(
            clauses[policy.permissive],
          );
        }
      }
      expect(await canTouch("beekeeping_auth", table.name), table.name).toBe(
        false,
      );
    }
  });

  it("keeps every other table for Better Auth alone", async () => {
    const others = tables.filter((table) => !table.hasOrgId);
    expect(others.map((table) => table.name)).toContain("two_factors");
    for (const table of others) {
      const own = policies.filter((policy) => policy.table === table.name);
      expect(own, table.name).not.toEqual([]);
      for (const policy of own) {
        expect(policy.roles, table.name).toEqual(["beekeeping_auth"]);
      }
      expect(await canTouch("beekeeping_app", table.name), table.name).toBe(
        false,
      );
    }
  });

  it("lets neither app role truncate a table, which skips it", async () => {
    for (const table of tables) {
      for (const role of appRoles) {
        const [row] = await query<{ truncate: boolean }>(
          `select has_table_privilege('${role}', 'public.${table.name}', 'truncate') as truncate`,
        );
        expect(row?.truncate, `${table.name}, ${role}`).toBe(false);
      }
    }
  });

  it("lets neither app role read a view that skips it", async () => {
    expect(await readableWithoutRowSecurity(await readRelations())).toEqual([]);
  });

  it("would catch such a view, and pass one that runs as its caller", async () => {
    // Made in this file's own database, by the owner, as a migration would.
    await query(`
      create view settings_everywhere as select * from organization_settings;
      create view settings_for_caller with (security_invoker = true)
        as select * from organization_settings;
      create materialized view settings_copy as select * from organization_settings`);
    try {
      expect(await readableWithoutRowSecurity(await readRelations())).toEqual([
        "settings_copy, beekeeping_app",
        "settings_everywhere, beekeeping_app",
      ]);
    } finally {
      await query(`
        drop view settings_everywhere;
        drop view settings_for_caller;
        drop materialized view settings_copy`);
    }
  });

  it("binds neither of the app's roles, which own nothing and skip nothing", async () => {
    expect(
      (await readRelations()).filter((relation) =>
        relation.owner.startsWith("beekeeping_"),
      ),
    ).toEqual([]);
    const roles = await query<{ rolname: string; rolbypassrls: boolean }>(
      `select rolname, rolbypassrls from pg_roles
        where rolname in ('beekeeping_app', 'beekeeping_auth') order by rolname`,
    );
    expect(roles).toEqual([
      { rolname: "beekeeping_app", rolbypassrls: false },
      { rolname: "beekeeping_auth", rolbypassrls: false },
    ]);
  });
});
