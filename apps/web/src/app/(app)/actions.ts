"use server";

import type { ActionInput, ActionName } from "@beekeeping/actions";

import { invokeForMember } from "../../server/actions.ts";

/**
 * The web app's door to the action registry: every registered action, for
 * the signed-in person, with the checks every door shares. A client can
 * send any name and any input here, so nothing is trusted: the registry
 * refuses a name it doesn't know, a role too low and input its schema
 * refuses.
 */
export async function callAction<Name extends ActionName>(
  name: Name,
  input: ActionInput<Name>,
) {
  return invokeForMember(name, input);
}
