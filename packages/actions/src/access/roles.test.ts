import { describe, expect, it } from "vitest";

import { isRole, organizationRoles, roleAtLeast, roleNames } from "./roles.ts";

describe("roles", () => {
  it("ranks owner, admin, bookkeeper and viewer, highest first", () => {
    expect(roleNames).toEqual(["owner", "admin", "bookkeeper", "viewer"]);
    expect(roleAtLeast("owner", "admin")).toBe(true);
    expect(roleAtLeast("admin", "admin")).toBe(true);
    expect(roleAtLeast("bookkeeper", "admin")).toBe(false);
    expect(roleAtLeast("viewer", "bookkeeper")).toBe(false);
  });

  it("ranks a role it doesn't know below every other, however it's spelled", () => {
    for (const unknown of ["agent", "owner,admin", "", undefined]) {
      expect(roleAtLeast(unknown as never, "viewer")).toBe(false);
      expect(roleAtLeast("owner", unknown as never)).toBe(false);
    }
  });

  it("knows only the four roles", () => {
    expect(roleNames.every(isRole)).toBe(true);
    expect(isRole("member")).toBe(false);
    expect(isRole("superuser")).toBe(false);
  });

  it.each([
    ["owner", true, true],
    ["admin", true, true],
    ["bookkeeper", false, true],
    ["viewer", false, false],
  ] as const)(
    "%s: may invite members %s, may write the books %s",
    (role, invite, write) => {
      const permissions = organizationRoles[role];
      expect(permissions.authorize({ invitation: ["create"] }).success).toBe(
        invite,
      );
      expect(permissions.authorize({ member: ["delete"] }).success).toBe(
        invite,
      );
      expect(permissions.authorize({ books: ["write"] }).success).toBe(write);
      expect(permissions.authorize({ books: ["read"] }).success).toBe(true);
    },
  );
});
