import { openDatabase, type DatabaseHandle } from "@beekeeping/db";
import { createTestDatabase, type TestDatabase } from "@beekeeping/db/testing";
import { asOwner, demoMember } from "@beekeeping/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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

describe("the audit log's events", () => {
  it("include the home currency's setting, with the owner who set it", async () => {
    const owner = await demoMember(database.url, "auditsetup", "owner");
    await invokeAction(app.db, owner, "set_up_organization", {
      homeCurrency: "EUR",
    });
    const listed = await invokeAction(app.db, owner, "list_audit_events", {});
    expect(listed).toMatchObject({
      ok: true,
      events: [
        {
          tableName: "organization_settings",
          recordId: owner.orgId,
          action: "insert",
          actorUserId: owner.userId,
          changes: { home_currency: "EUR" },
        },
      ],
      tables: ["organization_settings"],
    });
    const [event] = listed.ok ? listed.events : [];
    expect(new Date(event?.occurredAt ?? "").getTime()).not.toBeNaN();
  });

  it("are for admins and owners", async () => {
    for (const role of ["bookkeeper", "viewer"] as const) {
      const member = await demoMember(database.url, `audit${role}`, role);
      expect(
        await invokeAction(app.db, member, "list_audit_events", {}),
      ).toMatchObject({ ok: false, reason: "forbidden" });
    }
    const admin = await demoMember(database.url, "auditadmin", "admin");
    expect(
      await invokeAction(app.db, admin, "list_audit_events", {}),
    ).toMatchObject({ ok: true });
  });

  it("filter by table, by change and by day, newest first, up to the limit", async () => {
    const owner = await demoMember(database.url, "auditfilters", "owner");
    // Written by the owner, as only the triggers can: the app has no way in.
    for (const [day, table, action] of [
      ["2026-01-01", "organization_settings", "insert"],
      ["2026-02-15", "vault", "update"],
      ["2026-03-10", "vault", "delete"],
    ]) {
      await asOwner(
        database.url,
        `insert into audit_events (org_id, occurred_at, table_name, record_id, action, changes)
           values ($1, $2, $3, 'r', $4, '{}')`,
        [owner.orgId, `${day}T12:00:00Z`, table, action],
      );
    }
    const days = async (input: Record<string, unknown>) => {
      const outcome = await invokeAction(
        app.db,
        owner,
        "list_audit_events",
        input,
      );
      return outcome.ok
        ? outcome.events.map(({ occurredAt }) => occurredAt.slice(0, 10))
        : outcome.reason;
    };
    expect(await days({})).toEqual(["2026-03-10", "2026-02-15", "2026-01-01"]);
    expect(await days({ table: "vault" })).toEqual([
      "2026-03-10",
      "2026-02-15",
    ]);
    expect(await days({ action: "delete" })).toEqual(["2026-03-10"]);
    expect(await days({ from: "2026-02-01", to: "2026-02-28" })).toEqual([
      "2026-02-15",
    ]);
    expect(await days({ to: "2026-02-15" })).toEqual([
      "2026-02-15",
      "2026-01-01",
    ]);
    expect(await days({ limit: 1 })).toEqual(["2026-03-10"]);
    expect(
      await invokeAction(app.db, owner, "list_audit_events", {}),
    ).toMatchObject({ tables: ["organization_settings", "vault"] });
    for (const input of [
      { limit: 501 },
      { from: "March 1" },
      { action: "read" },
    ]) {
      expect(await days(input)).toBe("invalid_input");
    }
  });

  it("refuse a day or a table name Postgres can't read, rather than fail", async () => {
    const owner = await demoMember(database.url, "auditodd", "owner");
    const answer = async (input: Record<string, unknown>) => {
      const outcome = await invokeAction(
        app.db,
        owner,
        "list_audit_events",
        input,
      );
      return outcome.ok ? "ok" : outcome.reason;
    };
    // Year 0 and year 10000 reach Postgres in forms it refuses, and text
    // can't hold a NUL byte.
    for (const input of [
      { from: "0000-01-01" },
      { to: "9999-12-31" },
      { table: "organization\u0000settings" },
      { table: "Organization settings" },
    ]) {
      expect(await answer(input), JSON.stringify(input)).toBe("invalid_input");
    }
    for (const input of [{ from: "0001-01-01" }, { to: "9999-12-30" }]) {
      expect(await answer(input), JSON.stringify(input)).toBe("ok");
    }
  });

  it("include the from day's first moment, and stop where the day after to starts", async () => {
    const owner = await demoMember(database.url, "auditedges", "owner");
    for (const moment of ["2026-02-01T00:00:00Z", "2026-03-01T00:00:00Z"]) {
      await asOwner(
        database.url,
        `insert into audit_events (org_id, occurred_at, table_name, record_id, action, changes)
           values ($1, $2, 'vault', 'edge', 'update', '{}')`,
        [owner.orgId, moment],
      );
    }
    const outcome = await invokeAction(app.db, owner, "list_audit_events", {
      from: "2026-02-01",
      to: "2026-02-28",
    });
    expect(
      outcome.ok && outcome.events.map(({ occurredAt }) => occurredAt),
    ).toEqual(["2026-02-01T00:00:00.000Z"]);
  });

  it("list 100 events unless asked for more", async () => {
    const owner = await demoMember(database.url, "auditlimit", "owner");
    await asOwner(
      database.url,
      `insert into audit_events (org_id, table_name, record_id, action, changes)
         select $1, 'vault', 'r' || n, 'update', '{}' from generate_series(1, 101) as n`,
      [owner.orgId],
    );
    const count = async (input: Record<string, unknown>) => {
      const outcome = await invokeAction(
        app.db,
        owner,
        "list_audit_events",
        input,
      );
      return outcome.ok ? outcome.events.length : outcome.reason;
    };
    expect(await count({})).toBe(100);
    expect(await count({ limit: 500 })).toBe(101);
  });

  it("list the events of one transaction newest first, though they share a time", async () => {
    const owner = await demoMember(database.url, "auditorder", "owner");
    // One statement, so one transaction and one occurred_at for all five.
    await asOwner(
      database.url,
      `insert into audit_events (org_id, table_name, record_id, action, changes)
         select $1, 'vault', 'step ' || step, 'update', '{}'
           from generate_series(1, 5) as step`,
      [owner.orgId],
    );
    const outcome = await invokeAction(app.db, owner, "list_audit_events", {});
    expect(
      outcome.ok && outcome.events.map(({ recordId }) => recordId),
    ).toEqual(["step 5", "step 4", "step 3", "step 2", "step 1"]);
  });
});
