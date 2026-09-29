import { isRole, type Role } from "@beekeeping/actions";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { getAuth } from "./auth.ts";

// The reads below are cached for one page render, so a page and the
// actions it runs through runForMember see one session and one membership.
// Server actions and route handlers have no render, so each call there
// reads again: read once and pass the result on.

/** The signed-in person, or a trip to the sign-in page. */
export const requireSignedIn = cache(async () => {
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
});

export type OrganizationSummary = {
  readonly id: string;
  readonly name: string;
};

/** Every organization the signed-in person belongs to, by name. */
export const listMyOrganizations = cache(
  async (): Promise<OrganizationSummary[]> => {
    const organizations = await getAuth()
      .api.listOrganizations({ headers: await headers() })
      .catch(() => {
        // As with the session, the error carries the query, so none of it
        // goes on to Next.js's log.
        throw new Error("We couldn't read your organizations.");
      });
    return organizations
      .map(({ id, name }) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
);

export type Membership = {
  readonly organizationId: string;
  readonly organizationName: string;
  readonly role: Role;
};

/**
 * The organization the person is working in and their role there, read from
 * Postgres on every request, so a removed member loses access at once. The
 * organization and the role come from one membership row. Two separate
 * reads of the active organization could see a switch between them and
 * pair one organization with another's role.
 */
export const activeMembership = cache(
  async (): Promise<Membership | undefined> => {
    const requestHeaders = await headers();
    const auth = getAuth();
    const member = await auth.api
      .getActiveMember({ headers: requestHeaders })
      .catch(() => null);
    if (!member || !isRole(member.role)) return undefined;
    const organization = await auth.api
      .getOrganization({
        headers: requestHeaders,
        query: { organizationId: member.organizationId },
      })
      .catch(() => null);
    if (organization?.id !== member.organizationId) return undefined;
    return {
      organizationId: member.organizationId,
      organizationName: organization.name,
      role: member.role,
    };
  },
);
