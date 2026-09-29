import {
  openDatabase,
  organizationSettings,
  type DatabaseHandle,
} from "@beekeeping/db";
import { createTestDatabase, type TestDatabase } from "@beekeeping/db/testing";
import { fail, ok } from "@beekeeping/services";
import { asOwner, demoMember } from "@beekeeping/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { DatabaseRefusal, runAction, type Principal } from "./context.ts";

let database: TestDatabase;
let app: DatabaseHandle;
let owner: Principal;

beforeAll(async () => {
  database = await createTestDatabase();
  // One connection, so every query in a test runs on the same one.
  app = openDatabase(database.appUrl, { max: 1 });
  owner = await demoMember(database.url, "context", "owner");
});
afterAll(async () => {
  await app.close();
  await database.drop();
});
// Each test starts with no settings, whatever the one before it left.
beforeEach(() => asOwner(database.url, "delete from organization_settings"));

const settingsRows = () =>
  asOwner(
    database.url,
    "select org_id from organization_settings where org_id = $1",
    [owner.orgId],
  );

describe("runAction", () => {
  it("sets the organization and the person for its transaction only", async () => {
    const inside = await runAction(app.db, owner, async (ctx) => {
      const result = await ctx.tx.execute<{ org: string; person: string }>(
        sql`select current_org_id() as org, current_user_id() as person`,
      );
      return result.rows[0];
    });
    expect(inside).toEqual({ org: owner.orgId, person: owner.userId });

    const after = await app.pool.query<{ org: string | null }>(
      "select current_org_id() as org",
    );
    expect(after.rows[0]?.org).toBeNull();
  });

  it("keeps what an action wrote when it succeeds", async () => {
    await runAction(app.db, owner, async (ctx) => {
      await ctx.tx
        .insert(organizationSettings)
        .values({ orgId: ctx.orgId, homeCurrency: "USD" });
      return ok({});
    });
    expect(await settingsRows()).toHaveLength(1);
  });

  it("undoes what an action wrote when it returns a failure", async () => {
    const outcome = await runAction(app.db, owner, async (ctx) => {
      await ctx.tx
        .insert(organizationSettings)
        .values({ orgId: ctx.orgId, homeCurrency: "USD" });
      return fail("changed_its_mind");
    });
    expect(outcome).toEqual({ ok: false, reason: "changed_its_mind" });
    expect(await settingsRows()).toHaveLength(0);
  });

  it("undoes what an action wrote when it throws, and passes the error on", async () => {
    const thrown = runAction(app.db, owner, async (ctx) => {
      await ctx.tx
        .insert(organizationSettings)
        .values({ orgId: ctx.orgId, homeCurrency: "USD" });
      throw new Error("broke halfway");
    });
    await expect(thrown).rejects.toThrow("broke halfway");
    expect(await settingsRows()).toHaveLength(0);
  });

  it("throws when an action caught a failed query, instead of saving nothing quietly", async () => {
    const thrown = runAction(app.db, owner, async (ctx) => {
      await ctx.tx
        .insert(organizationSettings)
        .values({ orgId: ctx.orgId, homeCurrency: "USD" });
      await ctx.tx.execute(sql`select 1 / 0`).catch(() => undefined);
      return ok({});
    });
    await expect(thrown).rejects.toMatchObject({ code: "25P02" });
    expect(await settingsRows()).toHaveLength(0);
  });

  it("keeps a refused query and its values out of the error it throws", async () => {
    const thrown = await runAction(app.db, owner, (ctx) =>
      ctx.tx
        .insert(organizationSettings)
        .values({ orgId: ctx.orgId, homeCurrency: "acct-000123456789" }),
    ).catch((error: unknown) => error);
    expect(thrown).toBeInstanceOf(DatabaseRefusal);
    expect(thrown).toMatchObject({
      code: "23514",
      constraint: "organization_settings_home_currency_check",
    });
    const everything = JSON.stringify(
      thrown,
      Object.getOwnPropertyNames(thrown),
    );
    expect(everything).not.toContain("acct-000123456789");
    expect(everything).not.toContain("insert into");
  });
});
