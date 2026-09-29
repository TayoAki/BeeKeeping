// An organization's name, as someone types it when they create or rename
// one. It goes into invitation emails, so the server holds it to a limit.

/** The longest name the forms and the server accept. */
export const organizationNameLimit = 200;

/** A name with something in it, no longer than the limit. */
export function isOrganizationName(name: unknown): name is string {
  return (
    typeof name === "string" &&
    name.trim().length > 0 &&
    name.length <= organizationNameLimit
  );
}
