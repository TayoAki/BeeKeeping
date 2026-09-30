import type { Metadata } from "next";
import { roleAtLeast } from "@beekeeping/actions";
import { TableScroll } from "@beekeeping/ui";
import { headers } from "next/headers";
import { forbidden, redirect } from "next/navigation";

import { getAuth } from "../../../../server/auth.ts";
import {
  activeMembership,
  requireSignedIn,
} from "../../../../server/session.ts";
import {
  CancelInvitationButton,
  InviteForm,
  RemoveMemberButton,
} from "./member-forms.tsx";

// Below admin the page answers 403, and its title says so too, since the
// 403 page can't set one.
export async function generateMetadata(): Promise<Metadata> {
  const membership = await activeMembership();
  const refused = membership && !roleAtLeast(membership.role, "admin");
  return { title: refused ? "Not allowed" : "Members" };
}

export default async function MembersPage() {
  await requireSignedIn();
  const membership = await activeMembership();
  if (!membership) redirect("/");
  // Better Auth refuses inviting, removing and cancelling below admin on the
  // server too. Any member may still read who belongs to the organization,
  // and its pending invitations, through Better Auth's organization
  // endpoints: members see each other. This page keeps the tools for
  // managing them away from bookkeepers and viewers.
  if (!roleAtLeast(membership.role, "admin")) forbidden();

  // The organization the role above came from, even if the person switches
  // in another tab meanwhile.
  const organization = await getAuth()
    .api.getFullOrganization({
      headers: await headers(),
      query: { organizationId: membership.organizationId },
    })
    .catch(() => {
      // As in session.ts: the error carries the query and its parameters.
      throw new Error("We couldn't read the organization's members.");
    });
  // Better Auth leaves an expired invitation pending, so the date decides.
  const now = new Date();
  const open = (organization?.invitations ?? []).filter(
    (invitation) => invitation.status === "pending",
  );
  const pending = open.filter((invitation) => invitation.expiresAt > now);
  const expired = open.filter((invitation) => invitation.expiresAt <= now);

  return (
    <>
      <h1>Members</h1>
      <TableScroll label="Members">
        <table>
          <caption className="hint">Everyone who can open these books.</caption>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Email</th>
              <th scope="col">Role</th>
              <th scope="col">
                <span className="hint">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {(organization?.members ?? []).map((member) => (
              <tr key={member.id}>
                <td>{member.user.name}</td>
                <td className="address">{member.user.email}</td>
                <td>{member.role}</td>
                <td>
                  {member.role === "owner" ? null : (
                    <RemoveMemberButton
                      memberId={member.id}
                      name={member.user.name}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>

      <h2>Invitations waiting for an answer</h2>
      {pending.length === 0 ? (
        <p className="hint">None.</p>
      ) : (
        <ul>
          {pending.map((invitation) => (
            <li key={invitation.id}>
              {invitation.email}, as {invitation.role}{" "}
              <CancelInvitationButton
                invitationId={invitation.id}
                email={invitation.email}
              />
            </li>
          ))}
        </ul>
      )}
      {expired.length === 0 ? null : (
        <>
          <h2>Expired invitations</h2>
          <p className="hint">
            These links no longer work. Invite them again to send a new one.
          </p>
          <ul>
            {expired.map((invitation) => (
              <li key={invitation.id}>
                {invitation.email}, as {invitation.role}
              </li>
            ))}
          </ul>
        </>
      )}

      <InviteForm />
    </>
  );
}
