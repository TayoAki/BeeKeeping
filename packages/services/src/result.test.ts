import { describe, expect, expectTypeOf, it } from "vitest";

import { fail, ok, type Result } from "./result.ts";

function post(
  balanced: boolean,
): Result<{ entryId: string }, "unbalanced", { differenceMinor: bigint }> {
  return balanced
    ? ok({ entryId: "je_1" })
    : fail("unbalanced", { differenceMinor: 100n });
}

describe("ok", () => {
  it("marks a success and keeps its fields next to ok", () => {
    expect(ok({ entryId: "je_1" })).toEqual({ ok: true, entryId: "je_1" });
  });

  it("works without fields", () => {
    expect(ok()).toEqual({ ok: true });
  });

  it("keeps ok true even if a field tries to override it", () => {
    const sneaky = { ok: false } as unknown as { entryId: string };
    expect(ok(sneaky).ok).toBe(true);
  });

  it("refuses fields named ok or reason at compile time", () => {
    // @ts-expect-error A success can't carry its own reason field.
    expect(ok({ reason: "posted" }).ok).toBe(true);
  });

  it("refuses a class instance, whose methods the copy would drop", () => {
    // @ts-expect-error Pass a Date as a named field, as in ok({ postedAt }).
    expect(ok(new Date(0)).ok).toBe(true);
  });
});

describe("fail", () => {
  it("carries a reason code", () => {
    expect(fail("period_locked")).toEqual({
      ok: false,
      reason: "period_locked",
    });
  });

  it("keeps details next to the reason", () => {
    expect(fail("unbalanced", { differenceMinor: 100n })).toEqual({
      ok: false,
      reason: "unbalanced",
      differenceMinor: 100n,
    });
  });

  it("keeps ok false and the reason even if details try to override them", () => {
    const sneaky = { ok: true, reason: "other" } as unknown as {
      note: string;
    };
    expect(fail("unbalanced", sneaky)).toEqual({
      ok: false,
      reason: "unbalanced",
    });
  });
});

describe("Result", () => {
  it("makes callers check ok before they read anything else", () => {
    const result = post(true);
    expectTypeOf<keyof typeof result>().toEqualTypeOf<"ok">();

    expect(result.ok && result.entryId).toBe("je_1");
    if (result.ok) {
      expectTypeOf(result.entryId).toEqualTypeOf<string>();
    }
  });

  it("narrows a failure to its reason codes and details", () => {
    const result = post(false);
    expect(result.ok).toBe(false);

    if (!result.ok) {
      expectTypeOf(result.reason).toEqualTypeOf<"unbalanced">();
      expectTypeOf(result.differenceMinor).toEqualTypeOf<bigint>();
      expect(result.reason).toBe("unbalanced");
      expect(result.differenceMinor).toBe(100n);
    }
  });
});
