import {
  openDatabase,
  organizationSettings,
  type DatabaseHandle,
} from "@beekeeping/db";
import { createTestDatabase, type TestDatabase } from "@beekeeping/db/testing";
import { fail, ok } from "@beekeeping/services";
import { demoMember } from "@beekeeping/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { defineAction, definitionProblems } from "./define.ts";
import {
  actions,
  findAction,
  invokeAction,
  invokeDefinition,
  type ActionName,
} from "./registry.ts";

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

const read = (principal: Parameters<typeof invokeAction>[1]) =>
  invokeAction(app.db, principal, "get_organization_settings", {});

describe("the registry", () => {
  it("holds only complete definitions, each under a name of its own", () => {
    for (const action of actions) {
      expect([action.name, definitionProblems(action)]).toEqual([
        action.name,
        [],
      ]);
    }
    const names = actions.map((action) => action.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("finds an action by its name, and nothing by another", () => {
    expect(findAction("set_up_organization")?.kind).toBe("admin");
    for (const name of ["", "setUpOrganization", "constructor", "__proto__"]) {
      expect(findAction(name)).toBeUndefined();
    }
    expect(findAction(42)).toBeUndefined();
  });
});

describe("invokeAction", () => {
  it("answers unknown_action for a name the registry doesn't hold", async () => {
    const owner = await demoMember(database.url, "unknown", "owner");
    for (const name of ["drop_everything", "constructor", "toString"]) {
      expect(await invokeAction(app.db, owner, name as ActionName, {})).toEqual(
        {
          ok: false,
          reason: "unknown_action",
          message: "There's no such action.",
        },
      );
    }
  });

  it("answers forbidden below the action's role, and runs nothing", async () => {
    const viewer = await demoMember(database.url, "lowrole", "viewer");
    expect(
      await invokeAction(app.db, viewer, "set_up_organization", {
        homeCurrency: "USD",
      }),
    ).toEqual({
      ok: false,
      reason: "forbidden",
      message: "Your role in this organization doesn't allow that.",
    });
    expect(await read(viewer)).toMatchObject({ reason: "not_found" });
  });

  it("answers forbidden before it reads the input", async () => {
    const viewer = await demoMember(database.url, "roleorder", "viewer");
    expect(
      await invokeAction(app.db, viewer, "set_up_organization", {
        homeCurrency: 840,
      }),
    ).toEqual({
      ok: false,
      reason: "forbidden",
      message: "Your role in this organization doesn't allow that.",
    });
  });

  it("answers forbidden to a role it doesn't know", async () => {
    const owner = await demoMember(database.url, "oddrole", "owner");
    for (const role of ["agent", "owner,admin", ""]) {
      expect(
        await invokeAction(
          app.db,
          { ...owner, role: role as never },
          "get_organization_settings",
          {},
        ),
      ).toMatchObject({ ok: false, reason: "forbidden" });
    }
  });

  it("sends back at most 20 of the input's problems", async () => {
    const lines = defineAction({
      name: "take_lines",
      description: "Takes lines, for the test.",
      kind: "draft",
      role: "viewer",
      approval: "none",
      input: z.object({ lines: z.array(z.string()).max(100) }),
      output: z.object({}),
      run: () => Promise.resolve(ok()),
    });
    const viewer = await demoMember(database.url, "manylines", "viewer");
    const outcome = await invokeDefinition(app.db, viewer, lines, {
      lines: Array.from({ length: 5_000 }, (_, index) => index),
    });
    expect(outcome).toMatchObject({ ok: false, reason: "invalid_input" });
    const issues = !outcome.ok && "issues" in outcome ? outcome.issues : [];
    expect(issues).toHaveLength(20);
  });

  it("answers invalid_input with each refused field, and runs nothing", async () => {
    const owner = await demoMember(database.url, "badinput", "owner");
    for (const input of [undefined, "USD", { homeCurrency: 840 }, {}]) {
      const outcome = await invokeAction(
        app.db,
        owner,
        "set_up_organization",
        input,
      );
      expect(outcome).toMatchObject({ ok: false, reason: "invalid_input" });
      const issues = !outcome.ok && "issues" in outcome ? outcome.issues : [];
      expect(issues.length).toBeGreaterThan(0);
    }
    expect(await read(owner)).toMatchObject({ reason: "not_found" });
  });

  it("runs an action the role allows, and answers with its fields", async () => {
    const owner = await demoMember(database.url, "allowed", "owner");
    expect(
      await invokeAction(app.db, owner, "set_up_organization", {
        homeCurrency: " eur ",
      }),
    ).toEqual({ ok: true, settings: { homeCurrency: "EUR" } });
  });
});

describe("an action's output", () => {
  // Stand-ins that write a row, then answer as each test needs.
  const writesThen = (answer: unknown) =>
    defineAction({
      name: "write_then_answer",
      description: "Writes the caller's settings row, then answers.",
      kind: "admin",
      role: "owner",
      approval: "never",
      input: z.object({}),
      output: z.object({ settings: z.object({ homeCurrency: z.string() }) }),
      run: async (ctx) => {
        await ctx.tx
          .insert(organizationSettings)
          .values({ orgId: ctx.orgId, homeCurrency: "USD" });
        return answer as ReturnType<
          typeof ok<{ settings: { homeCurrency: string } }>
        >;
      },
    });

  it("keeps only the fields its schema names", async () => {
    const owner = await demoMember(database.url, "extrafields", "owner");
    expect(
      await invokeDefinition(
        app.db,
        owner,
        writesThen(
          ok({
            settings: { homeCurrency: "USD", secret: "left out" },
            internal: "left out",
          }),
        ),
        {},
      ),
    ).toEqual({ ok: true, settings: { homeCurrency: "USD" } });
  });

  it("throws, and rolls the writes back, when its schema refuses a success", async () => {
    const owner = await demoMember(database.url, "badoutput", "owner");
    await expect(
      invokeDefinition(
        app.db,
        owner,
        writesThen(ok({ settings: { homeCurrency: 840 } })),
        {},
      ),
    ).rejects.toThrow(
      "The action write_then_answer returned a success that its output schema refuses.",
    );
    expect(await read(owner)).toMatchObject({ reason: "not_found" });
  });

  it("passes on a failure's reason and message only, and rolls the writes back", async () => {
    const owner = await demoMember(database.url, "failure", "owner");
    const failure = fail("closed_period", {
      message: "That period is closed.",
      internal: "the ledger's lock id",
    });
    expect(
      await invokeDefinition(app.db, owner, writesThen(failure), {}),
    ).toEqual({
      ok: false,
      reason: "closed_period",
      message: "That period is closed.",
    });
    expect(await read(owner)).toMatchObject({ reason: "not_found" });
  });

  it("throws, and rolls the writes back, for an answer that isn't a result", async () => {
    const answers = [
      { message: "No ok at all." },
      { ok: false, message: "No reason." },
      { ok: false, reason: "no_message" },
    ];
    for (const [index, answer] of answers.entries()) {
      const owner = await demoMember(
        database.url,
        `notaresult${index}`,
        "owner",
      );
      await expect(
        invokeDefinition(app.db, owner, writesThen(answer), {}),
      ).rejects.toThrow("The action write_then_answer returned");
      expect(await read(owner)).toMatchObject({ reason: "not_found" });
    }
  });

  it("answers a success with no fields", async () => {
    const nothing = defineAction({
      name: "do_nothing",
      description: "Does nothing, for the test.",
      kind: "read",
      role: "viewer",
      approval: "none",
      input: z.object({}),
      output: z.object({}),
      run: () => Promise.resolve(ok()),
    });
    const viewer = await demoMember(database.url, "nofields", "viewer");
    expect(await invokeDefinition(app.db, viewer, nothing, {})).toEqual({
      ok: true,
    });
  });
});
