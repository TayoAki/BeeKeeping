import { randomUUID } from "node:crypto";

import {
  openDatabase,
  organizationSettings,
  type DatabaseHandle,
} from "@beekeeping/db";
import { createTestDatabase, type TestDatabase } from "@beekeeping/db/testing";
import { fail, ok } from "@beekeeping/services";
import { asOwner, demoMember } from "@beekeeping/testing";
import { DrizzleQueryError, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  DatabaseRefusal,
  runAction,
  withoutQuery,
  type AgentPrincipal,
  type PersonPrincipal,
  type Principal,
} from "./context.ts";

let database: TestDatabase;
let app: DatabaseHandle;
let owner: PersonPrincipal;

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
  const settings = (principal: Principal) =>
    runAction(app.db, principal, async (ctx) => {
      const result = await ctx.tx.execute<Record<string, string | null>>(
        sql`select current_org_id() as org, current_user_id() as person,
                   current_agent_id() as agent, current_approver_id() as approver`,
      );
      return result.rows[0];
    });

  it("sets the organization and the person for its transaction only", async () => {
    expect(await settings(owner)).toEqual({
      org: owner.orgId,
      person: owner.userId,
      agent: null,
      approver: null,
    });

    const after = await app.pool.query<{ org: string | null }>(
      "select current_org_id() as org",
    );
    expect(after.rows[0]?.org).toBeNull();
  });

  it("sets the agent and the person who approved, and no person, for an agent", async () => {
    const agent: AgentPrincipal = {
      kind: "agent",
      orgId: owner.orgId,
      agentId: randomUUID(),
      role: "bookkeeper",
      scope: "post",
    };
    expect(await settings(agent)).toEqual({
      org: owner.orgId,
      person: null,
      agent: agent.agentId,
      approver: null,
    });
    expect(await settings({ ...agent, approvedBy: owner.userId })).toEqual({
      org: owner.orgId,
      person: null,
      agent: agent.agentId,
      approver: owner.userId,
    });
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

describe("withoutQuery", () => {
  it("keeps the query and its values out when the database gave no code", () => {
    // As when the connection drops mid-query.
    const failed = new DrizzleQueryError(
      "select * from authenticate_api_token($1)",
      ["acct-000123456789"],
      new Error("Connection terminated unexpectedly"),
    );
    const scrubbed = withoutQuery(failed);
    expect(scrubbed).toBeInstanceOf(Error);
    const everything = JSON.stringify(
      scrubbed,
      Object.getOwnPropertyNames(scrubbed),
    );
    expect(everything).not.toContain("acct-000123456789");
    expect(everything).not.toContain("authenticate_api_token");
    // pg's own reason stays, since it holds no query.
    expect(String(scrubbed)).toContain("Connection terminated unexpectedly");
  });

  it("drops a reason pg didn't word itself, which might hold a value", () => {
    const failed = new DrizzleQueryError(
      "select $1",
      ["acct-000123456789"],
      new Error("could not serialize acct-000123456789"),
    );
    expect(String(withoutQuery(failed))).toBe(
      "Error: A query failed before the database answered.",
    );
  });

  it("passes on any other error as it is", () => {
    const own = new Error("broke halfway");
    expect(withoutQuery(own)).toBe(own);
  });
});
