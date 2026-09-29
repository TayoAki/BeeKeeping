import { describe, expect, it } from "vitest";

import { isPersonName, personNameLimit } from "./name.ts";

describe("isPersonName", () => {
  it("takes a name up to the limit", () => {
    expect(isPersonName("Avery Park")).toBe(true);
    expect(isPersonName("a".repeat(personNameLimit))).toBe(true);
  });

  it.each([
    ["an empty name", ""],
    ["spaces only", "   "],
    ["a name past the limit", "a".repeat(personNameLimit + 1)],
    ["something that isn't text", 42],
  ])("refuses %s", (_case, name) => {
    expect(isPersonName(name)).toBe(false);
  });
});
