import { ok, type Ok } from "@beekeeping/services";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  actionKinds,
  approvalCategories,
  defineAction,
  definitionProblems,
  type SuccessOutput,
} from "./define.ts";

// A caller's success type for an action with no fields holds { ok: true },
// the answer invokeAction gives. tsc checks this line.
const _noFields = z.object({});
const nothingToSay: Ok<SuccessOutput<typeof _noFields>> = { ok: true };
void nothingToSay;

const complete = {
  name: "list_demo_things",
  description: "Lists the demo company's things.",
  kind: "read",
  role: "viewer",
  approval: "none",
  input: z.object({}),
  output: z.object({ things: z.array(z.string()) }),
  run: () => Promise.resolve(ok({ things: [] })),
} as const;

const fields = Object.keys(complete) as (keyof typeof complete)[];

function without(field: keyof typeof complete) {
  const copy: Record<string, unknown> = { ...complete };
  delete copy[field];
  return copy;
}

describe("an action's definition", () => {
  it("is complete with every field", () => {
    expect(definitionProblems(complete)).toEqual([]);
    expect(fields).toEqual([
      "name",
      "description",
      "kind",
      "role",
      "approval",
      "input",
      "output",
      "run",
    ]);
  });

  it.each(fields)("is incomplete without its %s", (field) => {
    expect(definitionProblems(without(field))).toEqual([`${field} is missing`]);
  });

  it.each(fields)(
    "won't load without its %s: defineAction throws and names the field",
    (field) => {
      expect(() =>
        defineAction(without(field) as unknown as typeof complete),
      ).toThrow(`${field} is missing`);
    },
  );

  it.each([
    ["a name that isn't snake_case", { name: "listDemoThings" }, "name"],
    ["a name past 64 characters", { name: "a".repeat(65) }, "name"],
    ["an empty description", { description: "  " }, "description"],
    ["a kind that doesn't exist", { kind: "delete" }, "kind"],
    ["a role that doesn't exist", { role: "accountant" }, "role"],
    ["an approval that doesn't exist", { approval: "maybe" }, "approval"],
    ["a read that asks for approval", { approval: "ask" }, "approval"],
    [
      "a draft that asks for approval",
      { kind: "draft", approval: "policy" },
      "approval",
    ],
    ["a post with no approval", { kind: "post", approval: "none" }, "approval"],
    [
      "an admin action agents may call",
      { kind: "admin", approval: "ask" },
      "approval",
    ],
    ["input that isn't an object schema", { input: z.string() }, "input"],
    ["output that isn't a schema", { output: { things: [] } }, "output"],
    [
      "output that keeps fields it doesn't name",
      { output: z.looseObject({ things: z.array(z.string()) }) },
      "output",
    ],
    [
      "output with a catchall",
      {
        output: z.object({ things: z.array(z.string()) }).catchall(z.string()),
      },
      "output",
    ],
    [
      "output that names ok",
      { output: z.object({ ok: z.boolean() }) },
      "output",
    ],
    ["run that isn't a function", { run: "list" }, "run"],
  ])("is wrong with %s", (_case, change, field) => {
    const problems = definitionProblems({ ...complete, ...change });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(new RegExp(`^${field} `));
  });

  it.each([
    ["a post action", "policy", "post"],
    ["a post action", "ask", "post"],
    ["a post action", "never", "post"],
    ["an admin action", "never", "admin"],
    ["a draft", "none", "draft"],
  ])("takes %s with approval %s", (_case, approval, kind) => {
    expect(definitionProblems({ ...complete, kind, approval })).toEqual([]);
  });

  // Written out here, not read from approvalsFor, so a change there fails.
  const allowed = {
    read: ["none"],
    draft: ["none"],
    post: ["policy", "ask", "never"],
    admin: ["never"],
  } as const;
  it.each(
    actionKinds.flatMap((kind) =>
      approvalCategories.map((approval) => [kind, approval] as const),
    ),
  )(
    "takes kind %s with approval %s only as the design says",
    (kind, approval) => {
      const fits = (allowed[kind] as readonly string[]).includes(approval);
      const problems = definitionProblems({ ...complete, kind, approval });
      expect(problems).toHaveLength(fits ? 0 : 1);
      if (!fits) expect(problems[0]).toMatch(/^approval for a /);
    },
  );

  it.each([
    [
      "a loose object inside it",
      z.object({ settings: z.looseObject({ homeCurrency: z.string() }) }),
    ],
    [
      "a list of passthrough objects",
      z.object({ lines: z.array(z.object({ id: z.string() }).passthrough()) }),
    ],
    [
      "an optional catchall object",
      z.object({
        extra: z.object({ id: z.string() }).catchall(z.string()).optional(),
      }),
    ],
    [
      "a loose object in a union",
      z.object({
        item: z.union([z.looseObject({ id: z.string() }), z.null()]),
      }),
    ],
    [
      "a loose object in a discriminated union",
      z.object({
        party: z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("customer"), id: z.string() }),
          z.looseObject({ kind: z.literal("vendor"), id: z.string() }),
        ]),
      }),
    ],
    [
      "a readonly loose object",
      z.object({ item: z.looseObject({ id: z.string() }).readonly() }),
    ],
    [
      "a lazy loose object",
      z.object({ item: z.lazy(() => z.looseObject({ id: z.string() })) }),
    ],
    [
      "a loose object behind a pipe",
      z.object({
        item: z
          .looseObject({ id: z.string() })
          .pipe(z.looseObject({ id: z.string() })),
      }),
    ],
    [
      "a record of loose objects",
      z.object({
        byId: z.record(z.string(), z.looseObject({ id: z.string() })),
      }),
    ],
    [
      "a loose object in a tuple",
      z.object({ pair: z.tuple([z.string(), z.looseObject({})]) }),
    ],
    [
      "a loose object in an intersection",
      z.object({
        item: z.intersection(
          z.object({ id: z.string() }),
          z.looseObject({ name: z.string() }),
        ),
      }),
    ],
  ])("refuses an output with %s", (_case, output) => {
    expect(definitionProblems({ ...complete, output })).toEqual([
      expect.stringMatching(/^output must drop the fields/),
    ]);
  });

  it("takes a record of unknown values, which names no fields by design", () => {
    const output = z.object({ changes: z.record(z.string(), z.unknown()) });
    expect(definitionProblems({ ...complete, output })).toEqual([]);
  });

  it("takes a recursive output, such as a tree of accounts", () => {
    type Account = { name: string; children: Account[] };
    const account: z.ZodType<Account> = z.object({
      name: z.string(),
      get children() {
        return z.array(account);
      },
    });
    const output = z.object({ accounts: z.array(account) });
    expect(definitionProblems({ ...complete, output })).toEqual([]);
  });

  it("reports everything wrong with something that isn't a definition", () => {
    expect(definitionProblems(undefined)).toEqual(
      fields.map((field) => `${field} is missing`),
    );
  });
});
