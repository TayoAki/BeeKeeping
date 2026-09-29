// The cross-organization suite. Organization A has data; organization B's
// member calls every action. Each action must answer "not found" or touch
// only B's rows, and row-level security must stop what an action misses.
// Each test makes the organizations it needs, so the tests run in any order.
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
import {
  getOrganizationSettings,
  setUpOrganization,
} from "./organization/settings.ts";

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

// Every function the package exports that isn't an action, and the actions
// the cases below cover. An action exported later without a case fails.
const notActions = [
  "DatabaseRefusal",
  "isOrganizationName",
  "isPersonName",
  "isRole",
  "mayChangeRole",
  "mayInviteAs",
  "mayRemove",
  "maySignInByLink",
  "roleAtLeast",
  "runAction",
  "startingOrganization",
];
const covered = ["getOrganizationSettings", "setUpOrganization"];

describe("every action, called by another organization's member", () => {
  it("has a case here for every action the package exports", () => {
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
    expect(
      functions.filter(
        (name) => !notActions.includes(name) && !covered.includes(name),
      ),
    ).toEqual([]);
  });

  it("getOrganizationSettings: not found", async () => {
    const { b } = await twoOrganizations();
    expect(
      await runAction(app.db, b, (ctx) => getOrganizationSettings(ctx)),
    ).toMatchObject({ ok: false, reason: "not_found" });
  });

  it("setUpOrganization: writes only the caller's organization", async () => {
    const { a, b } = await twoOrganizations();
    const outcome = await runAction(app.db, b, (ctx) =>
      setUpOrganization(ctx, { homeCurrency: "EUR" }),
    );
    expect(outcome.ok).toBe(true);
    expect(await settingsOf(a.orgId)).toEqual([{ home_currency: "USD" }]);
    expect(await settingsOf(b.orgId)).toEqual([{ home_currency: "EUR" }]);
  });
});

describe("each action's own filter, where row-level security doesn't apply", () => {
  it("getOrganizationSettings: not found", async () => {
    const { b } = await twoOrganizations();
    // The owner skips row-level security, so only the action's own filter
    // keeps A's row from B. One connection, so the role change sticks.
    const owner = openDatabase(database.url, { max: 1 });
    try {
      await owner.pool.query("set role none");
      expect(
        await runAction(owner.db, b, (ctx) => getOrganizationSettings(ctx)),
      ).toMatchObject({ ok: false, reason: "not_found" });
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
