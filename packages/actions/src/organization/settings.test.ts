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
import { demoMember } from "@beekeeping/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runAction, type Principal } from "../context.ts";
import { invokeAction } from "../registry/registry.ts";

let database: TestDatabase;
let app: DatabaseHandle;

beforeAll(async () => {
  database = await createTestDatabase();
  app = openDatabase(database.appUrl);
});
afterAll(async () => {
  await app.close();
  await database.drop();
});

const setUp = (principal: Principal, homeCurrency: string) =>
  invokeAction(app.db, principal, "set_up_organization", { homeCurrency });
const read = (principal: Principal) =>
  invokeAction(app.db, principal, "get_organization_settings", {});

describe("setting up an organization", () => {
  it("records the home currency once, for the owner", async () => {
    const owner = await demoMember(database.url, "setup", "owner");
    expect(await read(owner)).toMatchObject({ ok: false, reason: "not_found" });
    expect(await setUp(owner, "eur")).toEqual({
      ok: true,
      settings: { homeCurrency: "EUR" },
    });
    expect(await read(owner)).toEqual({
      ok: true,
      settings: { homeCurrency: "EUR" },
    });
    expect(await setUp(owner, "USD")).toMatchObject({
      ok: false,
      reason: "already_set_up",
    });
    expect(await read(owner)).toEqual({
      ok: true,
      settings: { homeCurrency: "EUR" },
    });
  });

  it("refuses a currency it doesn't know", async () => {
    const owner = await demoMember(database.url, "badcurrency", "owner");
    expect(await setUp(owner, "ABC")).toMatchObject({
      ok: false,
      reason: "unknown_currency",
    });
    expect(await read(owner)).toMatchObject({ ok: false, reason: "not_found" });
  });

  it("tells the person what went wrong", async () => {
    const owner = await demoMember(database.url, "messages", "owner");
    const outcome = await setUp(owner, "ABC");
    expect(outcome).toEqual({
      ok: false,
      reason: "unknown_currency",
      message: "Choose a currency from the list.",
    });
  });

  it("can't be changed or deleted afterwards, even by a query that skips the action", async () => {
    const owner = await demoMember(database.url, "keep", "owner");
    await setUp(owner, "GBP");
    const changed = await postgresError(
      runAction(app.db, owner, (ctx) =>
        ctx.tx.update(organizationSettings).set({ homeCurrency: "USD" }),
      ),
    );
    // The trigger's check_violation, with the query left out.
    expect(changed.code).toBe("23514");
    const deleted = await postgresError(
      runAction(app.db, owner, (ctx) => ctx.tx.delete(organizationSettings)),
    );
    expect(deleted.code).toBe("42501");
    expect(await read(owner)).toEqual({
      ok: true,
      settings: { homeCurrency: "GBP" },
    });
  });

  it("is for the owner alone", async () => {
    for (const role of ["admin", "bookkeeper", "viewer"] as const) {
      const member = await demoMember(database.url, `setup${role}`, role);
      expect(await setUp(member, "USD")).toMatchObject({
        ok: false,
        reason: "forbidden",
      });
      expect(await read(member)).toMatchObject({
        ok: false,
        reason: "not_found",
      });
    }
  });

  it("takes only a three-letter code", async () => {
    const owner = await demoMember(database.url, "notacode", "owner");
    expect(await setUp(owner, "US Dollar")).toMatchObject({
      ok: false,
      reason: "invalid_input",
      issues: [
        {
          path: "homeCurrency",
          message: "Use a three-letter currency code, such as USD.",
        },
      ],
    });
    expect(await read(owner)).toMatchObject({ ok: false, reason: "not_found" });
  });
});
