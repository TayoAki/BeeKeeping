type AuthResult = { error: { message?: string } | null };

/** What a form says when a request never reached the server. */
export const connectionLost =
  "We couldn't reach BeeKeeping. Check your connection and try again.";

/**
 * Runs one call to the auth client and returns the message to show when it
 * fails, or undefined when it worked. The client answers a refused request
 * with an error object and a lost connection with a rejected promise; both
 * come back as a message.
 */
export async function failureOf(
  call: Promise<AuthResult>,
  fallback: string,
): Promise<string | undefined> {
  try {
    const result = await call;
    return result.error ? (result.error.message ?? fallback) : undefined;
  } catch {
    return connectionLost;
  }
}
