import {
  invokeAction,
  type ActionInput,
  type ActionName,
  type ActionOutcome,
} from "@beekeeping/actions";
import { fail, type Fail } from "@beekeeping/services";

import { database } from "./database.ts";
import { activeMembership, requireSignedIn } from "./session.ts";

/**
 * Calls one registered action for the signed-in person in their active
 * organization. The organization, the person and the role come from the
 * session, never from the request. The registry checks the role, the input
 * and the output: the input's type helps a page get it right, and a server
 * action passes on whatever the browser sent.
 */
export async function invokeForMember<Name extends ActionName>(
  name: Name,
  input: ActionInput<Name>,
): Promise<ActionOutcome<Name> | Fail<"no_organization", { message: string }>> {
  const session = await requireSignedIn();
  const membership = await activeMembership();
  if (!membership) {
    return fail("no_organization", {
      message: "Choose an organization first.",
    });
  }
  const handle = database();
  if (!handle) throw new Error("DATABASE_URL isn't set.");
  return invokeAction(
    handle.db,
    {
      kind: "person",
      orgId: membership.organizationId,
      userId: session.user.id,
      role: membership.role,
    },
    name,
    input,
  );
}
