// A person's name, as they type it when they sign up or change it. It goes
// into invitation emails, so the server holds it to a limit.

/** The longest name the forms and the server accept. */
export const personNameLimit = 100;

/** A name with something in it, no longer than the limit. */
export function isPersonName(name: unknown): name is string {
  return (
    typeof name === "string" &&
    name.trim().length > 0 &&
    name.length <= personNameLimit
  );
}
