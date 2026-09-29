import { isRole, type Role } from "@beekeeping/actions";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getAuth } from "./auth.ts";

/** The signed-in person, or a trip to the sign-in page. */
export async function requireSignedIn() {
  // Reading the headers first marks the page dynamic, so Next.js never tries
  // to build it ahead of time, when there are no settings to read.
  const requestHeaders = await headers();
  const session = await getAuth()
    .api.getSession({ headers: requestHeaders })
    .catch(() => {
      // The error carries the query and its parameters, the session token
      // among them, so none of it goes on to Next.js's log.
      throw new Error("We couldn't read the session.");
    });
  if (!session) redirect("/sign-in");
  return session;
}

export type Membership = {
  readonly organizationId: string;
  readonly organizationName: string;
  readonly role: Role;
};

/**
 * The organization the person is working in and their role there, read from
 * Postgres on every request, so a removed member loses access at once.
 */
export async function activeMembership(): Promise<Membership | undefined> {
  const requestHeaders = await headers();
  const auth = getAuth();
  const organization = await auth.api
    .getFullOrganization({ headers: requestHeaders })
    .catch(() => null);
  if (!organization) return undefined;
  const member = await auth.api
    .getActiveMember({ headers: requestHeaders })
    .catch(() => null);
  if (!member || !isRole(member.role)) return undefined;
  return {
    organizationId: organization.id,
    organizationName: organization.name,
    role: member.role,
  };
}
