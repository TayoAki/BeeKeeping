import { createAccessControl } from "better-auth/plugins/access";
import {
  adminAc,
  defaultStatements,
  ownerAc,
} from "better-auth/plugins/organization/access";

/** The four roles a member of an organization can hold, highest first. */
export const roleNames = ["owner", "admin", "bookkeeper", "viewer"] as const;

export type Role = (typeof roleNames)[number];

/** The roles an invitation may offer. Ownership changes hands separately. */
export const invitableRoles = ["admin", "bookkeeper", "viewer"] as const;

export function isRole(value: string): value is Role {
  return (roleNames as readonly string[]).includes(value);
}

/** True when role is needed or higher: an owner may do what an admin may. */
export function roleAtLeast(role: Role, needed: Role): boolean {
  return roleNames.indexOf(role) <= roleNames.indexOf(needed);
}

const statements = {
  ...defaultStatements,
  books: ["read", "write"],
} as const;

/**
 * Better Auth checks these permissions on its organization endpoints, so only
 * owners and admins can invite, change roles or remove members. Bookkeepers
 * keep the books, and viewers read them.
 */
export const accessControl = createAccessControl(statements);

export const organizationRoles = {
  owner: accessControl.newRole({
    ...ownerAc.statements,
    books: ["read", "write"],
  }),
  admin: accessControl.newRole({
    ...adminAc.statements,
    books: ["read", "write"],
  }),
  bookkeeper: accessControl.newRole({ books: ["read", "write"] }),
  viewer: accessControl.newRole({ books: ["read"] }),
};
