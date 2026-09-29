// Who may be invited, changed or removed, and when a sign-in link is enough.
// Better Auth asks these through its hooks; the rules live here, where they
// are tested without a database.
import { invitableRoles } from "./roles.ts";

/** Better Auth passes one role, or several joined with commas. */
function rolesIn(value: string): string[] {
  return value
    .split(",")
    .map((role) => role.trim())
    .filter(Boolean);
}

/** An invitation offers one role: admin, bookkeeper or viewer, never owner. */
export function mayInviteAs(role: string): boolean {
  const roles = rolesIn(role);
  return (
    roles.length === 1 &&
    (invitableRoles as readonly string[]).includes(roles[0] ?? "")
  );
}

/**
 * An owner's role never changes here, and a member's new role is one that
 * could be invited: never owner, and never several at once.
 */
export function mayChangeRole(current: string, next: string): boolean {
  return !rolesIn(current).includes("owner") && mayInviteAs(next);
}

/** An owner is never removed. */
export function mayRemove(role: string): boolean {
  return !rolesIn(role).includes("owner");
}

/**
 * A link by email proves only that someone reads the mailbox. With
 * two-factor on, only the password and its code sign the person in.
 */
export function maySignInByLink(user: object | null | undefined): boolean {
  // Better Auth's user type leaves out the fields plugins add.
  return (
    (user as { twoFactorEnabled?: unknown } | null | undefined)
      ?.twoFactorEnabled !== true
  );
}

/**
 * The organization a new session starts in: the person's only one. Someone
 * in several picks one after signing in.
 */
export function startingOrganization(
  memberships: readonly { organizationId: string }[],
): string | undefined {
  return memberships.length === 1 ? memberships[0]?.organizationId : undefined;
}
