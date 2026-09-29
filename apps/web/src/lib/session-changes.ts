import type { useRouter } from "next/navigation";

import { failureOf } from "./auth-call.ts";
import { authClient } from "./auth-client.ts";

type Router = ReturnType<typeof useRouter>;

/**
 * Signs out in this browser, then opens the sign-in page. Answers the
 * message to show when it failed, and stays put.
 */
export async function signOutHere(router: Router): Promise<string | undefined> {
  const failure = await failureOf(
    authClient.signOut(),
    "We couldn't sign you out. Try again.",
  );
  if (failure) return failure;
  router.replace("/sign-in");
  router.refresh();
  return undefined;
}

/**
 * Makes an organization the one this session works in. Answers the
 * message to show when it failed.
 */
export function openOrganization(
  organizationId: string,
): Promise<string | undefined> {
  return failureOf(
    authClient.organization.setActive({ organizationId }),
    "We couldn't open that organization.",
  );
}
