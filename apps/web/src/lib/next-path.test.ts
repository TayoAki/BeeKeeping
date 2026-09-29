import { describe, expect, it } from "vitest";

import { safeNextPath } from "./next-path.ts";

describe("safeNextPath", () => {
  it.each([
    ["/", "/"],
    ["/settings/members", "/settings/members"],
    ["/invitations/0b6f?from=email#join", "/invitations/0b6f?from=email#join"],
  ])("keeps %j", (next, kept) => {
    expect(safeNextPath(next)).toBe(kept);
  });

  it.each([
    [undefined],
    [["/a", "/b"]],
    [""],
    ["settings"],
    ["https://evil.example/"],
    ["javascript:alert(1)"],
    ["//evil.example/"],
    ["/\\evil.example/"],
    ["/\t/evil.example/"],
    ["/\n/evil.example/"],
    ["/%5Cevil.example/"],
    ["/%2F%2Fevil.example/"],
    ["/\u0000"],
    ["/.//evil.example/"],
    ["/..//evil.example/"],
    ["/%2e//evil.example/"],
    ["/a/..//evil.example"],
  ])("sends %j to the home page", (next) => {
    expect(safeNextPath(next)).toBe("/");
  });
});
