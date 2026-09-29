import { describe, expect, it } from "vitest";

import {
  mayChangeRole,
  mayInviteAs,
  mayRemove,
  maySignInByLink,
  startingOrganization,
} from "./membership.ts";

describe("mayInviteAs", () => {
  it.each(["admin", "bookkeeper", "viewer"])("offers %s", (role) => {
    expect(mayInviteAs(role)).toBe(true);
  });

  it.each(["owner", "admin,owner", "viewer,admin", "", "superadmin"])(
    "refuses %j",
    (role) => {
      expect(mayInviteAs(role)).toBe(false);
    },
  );
});

describe("mayChangeRole", () => {
  it("lets an admin become a bookkeeper", () => {
    expect(mayChangeRole("admin", "bookkeeper")).toBe(true);
  });

  it.each([
    ["owner", "admin"],
    ["admin", "owner"],
    ["viewer", "admin,owner"],
    ["viewer", "admin, owner"],
    ["admin,owner", "viewer"],
    ["viewer", "admin,bookkeeper"],
    ["viewer", ""],
    ["viewer", "superadmin"],
  ])("refuses %s to %j", (current, next) => {
    expect(mayChangeRole(current, next)).toBe(false);
  });
});

describe("mayRemove", () => {
  it("removes anyone but an owner", () => {
    expect(mayRemove("bookkeeper")).toBe(true);
    expect(mayRemove("owner")).toBe(false);
    expect(mayRemove("admin,owner")).toBe(false);
  });
});

describe("maySignInByLink", () => {
  it("takes a link only when two-factor is off", () => {
    expect(maySignInByLink({ twoFactorEnabled: false })).toBe(true);
    expect(maySignInByLink({ twoFactorEnabled: null })).toBe(true);
    expect(maySignInByLink(null)).toBe(true);
    expect(maySignInByLink({ twoFactorEnabled: true })).toBe(false);
  });
});

describe("startingOrganization", () => {
  it("starts in the only organization, and in none of several", () => {
    expect(startingOrganization([])).toBeUndefined();
    expect(startingOrganization([{ organizationId: "a" }])).toBe("a");
    expect(
      startingOrganization([{ organizationId: "a" }, { organizationId: "b" }]),
    ).toBeUndefined();
  });
});
