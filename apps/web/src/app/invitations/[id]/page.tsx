import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";

import { SignOutButton } from "../../../components/sign-out-button.tsx";
import { getAuth } from "../../../server/auth.ts";
import { AcceptInvitation } from "./accept-invitation.tsx";

export const metadata: Metadata = { title: "Invitation" };

export default async function InvitationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const requestHeaders = await headers();
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: requestHeaders });
  const here = `/invitations/${id}`;

  if (!session) {
    return (
      <main>
        <h1>You&apos;re invited to BeeKeeping</h1>
        <p>
          Sign in or create an account with the address the invitation went to.
        </p>
        <p>
          <Link href={{ pathname: "/sign-up", query: { next: here } }}>
            Create an account
          </Link>{" "}
          or{" "}
          <Link href={{ pathname: "/sign-in", query: { next: here } }}>
            sign in
          </Link>
        </p>
      </main>
    );
  }

  // Better Auth shows an invitation only to the address it was sent to.
  const invitation = await auth.api
    .getInvitation({ headers: requestHeaders, query: { id } })
    .catch(() => null);
  if (!invitation || invitation.status !== "pending") {
    return (
      <main>
        <h1>This invitation isn&apos;t available</h1>
        <p>
          It may have expired or been used, or it went to an address other than{" "}
          {session.user.email}. To use another address, sign out, then open the
          link in the invitation again.
        </p>
        <p>
          <Link href="/">Back to your books</Link>
        </p>
        <SignOutButton />
      </main>
    );
  }

  return (
    <main>
      <h1>Join {invitation.organizationName}</h1>
      <p>
        {invitation.inviterEmail} invited you as {invitation.role}.
      </p>
      <AcceptInvitation invitationId={invitation.id} />
    </main>
  );
}
