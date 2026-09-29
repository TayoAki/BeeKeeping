import { describe, expect, it } from "vitest";

import { isOrganizationName, organizationNameLimit } from "./name.ts";

describe("isOrganizationName", () => {
  it("takes a name up to the limit", () => {
    expect(isOrganizationName("Honeycomb Design Studio (demo)")).toBe(true);
    expect(isOrganizationName("a".repeat(organizationNameLimit))).toBe(true);
  });

  it.each([
    ["an empty name", ""],
    ["spaces only", "   "],
    ["a name past the limit", "a".repeat(organizationNameLimit + 1)],
    ["something that isn't text", 42],
  ])("refuses %s", (_case, name) => {
    expect(isOrganizationName(name)).toBe(false);
  });
});
