// Actions decide the why and when: who may act, whether the action is allowed
// now, what it means in the ledger, and what the user sees when it fails.
// They read and write our tables inside the request's transaction.
// Orchestration that many actions share, such as postEntry, lives in shared/.
// See "Writing code with code-structure" in docs/execution-plan.md.
export {
  accessControl,
  invitableRoles,
  isRole,
  organizationRoles,
  roleAtLeast,
  roleNames,
  type Role,
} from "./access/roles.ts";
export {
  mayChangeRole,
  mayInviteAs,
  mayRemove,
  maySignInByLink,
  startingOrganization,
} from "./access/membership.ts";
export * as authEmails from "./auth/emails.ts";
export type { EmailContent } from "./auth/emails.ts";
export { isPersonName, personNameLimit } from "./auth/name.ts";
export {
  DatabaseRefusal,
  runAction,
  type ActionContext,
  type Principal,
} from "./context.ts";
export {
  getOrganizationSettings,
  setUpOrganization,
  type OrganizationSettings,
} from "./organization/settings.ts";
export {
  isOrganizationName,
  organizationNameLimit,
} from "./organization/name.ts";
