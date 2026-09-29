import { runAction, type ActionContext } from "@beekeeping/actions";
import { fail, type Fail } from "@beekeeping/services";

import { database } from "./database.ts";
import { activeMembership, requireSignedIn } from "./session.ts";

/**
 * Runs one action for the signed-in person in their active organization.
 * The organization, the person and the role come from the session, never
 * from the request's input.
 */
export async function runForMember<Outcome>(
  action: (ctx: ActionContext) => Promise<Outcome>,
): Promise<Outcome | Fail<"no_organization", { message: string }>> {
  const session = await requireSignedIn();
  const membership = await activeMembership();
  if (!membership) {
    return fail("no_organization", {
      message: "Choose an organization first.",
    });
  }
  const handle = database();
  if (!handle) throw new Error("DATABASE_URL isn't set.");
  return runAction(
    handle.db,
    {
      orgId: membership.organizationId,
      userId: session.user.id,
      role: membership.role,
    },
    action,
  );
}
