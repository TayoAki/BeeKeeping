import { describe, expect, it } from "vitest";

import { actorText, changeLines, tableName, when } from "./event-text.ts";

describe("the audit log page's words", () => {
  const members = new Map([
    [
      "9d7c1f2e-5b3a-4c8d-9e0f-1a2b3c4d5e6f",
      { name: "Avery Park", email: "avery@honeycomb-demo.test" },
    ],
  ]);

  it("names a member by name and address", () => {
    expect(actorText("9d7c1f2e-5b3a-4c8d-9e0f-1a2b3c4d5e6f", members)).toEqual({
      name: "Avery Park",
      email: "avery@honeycomb-demo.test",
    });
  });

  it("says BeeKeeping itself when no person acted", () => {
    expect(actorText(null, members)).toEqual({ name: "BeeKeeping itself" });
  });

  it("says someone left when the person isn't a member any more", () => {
    expect(actorText("0f1e2d3c-4b5a-4968-8776-655443322110", members)).toEqual({
      name: "Someone no longer in this organization",
    });
  });

  it("words each kind of change", () => {
    expect(changeLines("insert", { home_currency: "USD" })).toEqual([
      "Home currency: USD",
    ]);
    expect(changeLines("update", { home_currency: ["USD", "EUR"] })).toEqual([
      "Home currency: USD to EUR",
    ]);
    expect(changeLines("delete", { label: null, rate: 0.2 })).toEqual([
      "label: empty",
      "rate: 0.2",
    ]);
  });

  it("names known tables, and shows others as they are", () => {
    expect(tableName("organization_settings")).toBe("Organization settings");
    expect(tableName("vault")).toBe("vault");
  });

  it("shows a moment to the minute, in UTC", () => {
    expect(when("2026-09-29T23:05:12.345Z")).toBe("2026-09-29 23:05");
  });
});
