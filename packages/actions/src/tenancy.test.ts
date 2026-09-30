// The cross-organization suite. Organization A has data; organization B's
// member calls every registered action. Each action must answer "not
// found" or touch only B's rows, and row-level security must stop what an
// action misses. Each test makes the organizations it needs, so the tests
// run in any order.
import {
  openDatabase,
  organizationSettings,
  type DatabaseHandle,
} from "@beekeeping/db";
import {
  createTestDatabase,
  postgresError,
  type TestDatabase,
} from "@beekeeping/db/testing";
import { asOwner, demoMember } from "@beekeeping/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runAction, type Principal } from "./context.ts";
import * as exported from "./index.ts";
import { definitionProblems } from "./registry/define.ts";
import { actions, invokeAction, type ActionName } from "./registry/registry.ts";

let database: TestDatabase;
let app: DatabaseHandle;
let made = 0;

const settingsOf = (orgId: string) =>
  asOwner<{ home_currency: string }>(
    database.url,
    "select home_currency from organization_settings where org_id = $1",
    [orgId],
  );

/**
 * Two new organizations: A with its home currency set, B with none yet, or
 * with its own when bCurrency is given.
 */
async function twoOrganizations(
  bCurrency?: string,
): Promise<{ a: Principal; b: Principal }> {
  made += 1;
  const a = await demoMember(database.url, `orga${made}`, "owner");
  const b = await demoMember(database.url, `orgb${made}`, "owner");
  await asOwner(
    database.url,
    "insert into organization_settings (org_id, home_currency) values ($1, 'USD')",
    [a.orgId],
  );
  if (bCurrency) {
    await asOwner(
      database.url,
      "insert into organization_settings (org_id, home_currency) values ($1, $2)",
      [b.orgId, bCurrency],
    );
  }
  return { a, b };
}

beforeAll(async () => {
  database = await createTestDatabase();
  app = openDatabase(database.appUrl);
});
afterAll(async () => {
  await app.close();
  await database.drop();
});

// One case for each registered action: B's member calls it while A has
// data. The type asks for a case for every name in the registry.
const cases: Record<ActionName, (a: Principal, b: Principal) => Promise<void>> =
  {
    get_organization_settings: async (_a, b) => {
      expect(
        await invokeAction(app.db, b, "get_organization_settings", {}),
      ).toMatchObject({ ok: false, reason: "not_found" });
    },
    list_audit_events: async (a, b) => {
      // Setting A's currency left an event in A's log, and none in B's.
      expect(
        await invokeAction(app.db, a, "list_audit_events", {}),
      ).toMatchObject({
        ok: true,
        events: [{ tableName: "organization_settings" }],
      });
      expect(await invokeAction(app.db, b, "list_audit_events", {})).toEqual({
        ok: true,
        events: [],
        tables: [],
      });
    },
    set_up_organization: async (a, b) => {
      const outcome = await invokeAction(app.db, b, "set_up_organization", {
        homeCurrency: "EUR",
      });
      expect(outcome.ok).toBe(true);
      expect(await settingsOf(a.orgId)).toEqual([{ home_currency: "USD" }]);
      expect(await settingsOf(b.orgId)).toEqual([{ home_currency: "EUR" }]);
    },
  };

// Every function the package exports. No action is among them: actions are
// in the registry, and invokeAction runs them. A function exported later
// fails the test until it's listed here on purpose.
const exportedFunctions = [
  "DatabaseRefusal",
  "findAction",
  "invokeAction",
  "isOrganizationName",
  "isPersonName",
  "isRole",
  "mayChangeRole",
  "mayInviteAs",
  "mayRemove",
  "maySignInByLink",
  "roleAtLeast",
  "startingOrganization",
];

describe("every action, called by another organization's member", () => {
  it("has a case here for every registered action", () => {
    expect(Object.keys(cases).sort()).toEqual(
      actions.map((action) => action.name).sort(),
    );
  });

  it("is reached only through the registry", () => {
    // Functions, and functions inside exported namespaces such as
    // authEmails, whose email templates aren't actions.
    const functions = Object.entries(exported).flatMap(([name, value]) => {
      if (typeof value === "function") return [name];
      const namespace =
        Object.prototype.toString.call(value) === "[object Module]";
      if (!namespace || name === "authEmails") return [];
      return Object.entries(value as object)
        .filter(([, inner]) => typeof inner === "function")
        .map(([inner]) => `${name}.${inner}`);
    });
    expect(functions.sort()).toEqual(exportedFunctions);
  });

  it("exports no action definition outside the registry", () => {
    // Namespaces, lists and objects too, since the package exports
    // namespaces. Only the registry's own list may hold one.
    const found: string[] = [];
    const visit = (path: string, value: unknown, depth: number): void => {
      if (typeof value !== "object" || value === null) return;
      if (definitionProblems(value).length === 0) found.push(path);
      else if (depth < 3) {
        for (const [key, inner] of Object.entries(value)) {
          visit(`${path}.${key}`, inner, depth + 1);
        }
      }
    };
    for (const [name, value] of Object.entries(exported)) {
      if (name !== "actions") visit(name, value, 0);
    }
    expect(found).toEqual([]);
  });

  it.each(actions.map((action) => action.name))("%s", async (name) => {
    const { a, b } = await twoOrganizations();
    await cases[name](a, b);
  });
});

describe("each action's own filter, where row-level security doesn't apply", () => {
  it("get_organization_settings and list_audit_events: nothing of A's", async () => {
    const { a, b } = await twoOrganizations();
    // B's one table sorts between A's organization_settings and vault, so a
    // missing filter at either step of the table list adds one of A's.
    await asOwner(
      database.url,
      `insert into audit_events (org_id, table_name, record_id, action, changes)
         values ($1, 'payments', 'b1', 'insert', '{}'), ($2, 'vault', 'a1', 'insert', '{}')`,
      [b.orgId, a.orgId],
    );
    // The owner skips row-level security, so only the action's own filter
    // keeps A's row from B. One connection, so the role change sticks.
    const owner = openDatabase(database.url, { max: 1 });
    try {
      await owner.pool.query("set role none");
      expect(
        await invokeAction(owner.db, b, "get_organization_settings", {}),
      ).toMatchObject({ ok: false, reason: "not_found" });
      expect(
        await invokeAction(owner.db, b, "list_audit_events", {}),
      ).toMatchObject({
        ok: true,
        events: [{ recordId: "b1" }],
        tables: ["payments"],
      });
    } finally {
      await owner.close();
    }
  });
});

describe("row-level security, when an action forgets the organization", () => {
  it("shows only the caller's rows", async () => {
    const { b } = await twoOrganizations("EUR");
    const rows = await runAction(app.db, b, (ctx) =>
      ctx.tx.select().from(organizationSettings),
    );
    expect(rows.map((row) => row.orgId)).toEqual([b.orgId]);
  });

  it("refuses a row for another organization", async () => {
    const { a, b } = await twoOrganizations();
    const error = await postgresError(
      runAction(app.db, b, (ctx) =>
        ctx.tx
          .insert(organizationSettings)
          .values({ orgId: a.orgId, homeCurrency: "GBP" }),
      ),
    );
    expect(error.code).toBe("42501");
  });

  it("changes nothing of another organization's", async () => {
    const { a, b } = await twoOrganizations("EUR");
    // The home currency never changes for anyone, so this changes a column
    // that may, to see row-level security at work.
    const changed = await runAction(app.db, b, (ctx) =>
      ctx.tx
        .update(organizationSettings)
        .set({ updatedAt: new Date(0) })
        .where(eq(organizationSettings.orgId, a.orgId))
        .returning(),
    );
    expect(changed).toEqual([]);
    expect(
      await asOwner(
        database.url,
        "select updated_at > '2000-01-01' as untouched from organization_settings where org_id = $1",
        [a.orgId],
      ),
    ).toEqual([{ untouched: true }]);
  });

  it("shows nothing outside an action, where no organization is set", async () => {
    await twoOrganizations("EUR");
    const { rows } = await app.pool.query(
      "select * from organization_settings",
    );
    expect(rows).toEqual([]);
  });
});

describe("sign-in's tables", () => {
  const authTables = [
    "accounts",
    "invitations",
    "members",
    "organizations",
    "rate_limits",
    "sessions",
    "two_factors",
    "users",
    "verifications",
  ];

  it.each(authTables)("%s is out of the app's reach", async (table) => {
    const error = await postgresError(
      app.pool.query(`select 1 from ${table} limit 1`),
    );
    expect(error.code).toBe("42501");
  });

  it("are Better Auth's, which can't reach the app's tables", async () => {
    await twoOrganizations();
    const auth = openDatabase(database.appUrl, { role: "auth", max: 1 });
    try {
      const { rows } = await auth.pool.query<{ count: string }>(
        "select count(*) from users",
      );
      expect(Number(rows[0]?.count)).toBeGreaterThan(0);
      const error = await postgresError(
        auth.pool.query("select 1 from organization_settings limit 1"),
      );
      expect(error.code).toBe("42501");
    } finally {
      await auth.close();
    }
  });
});
