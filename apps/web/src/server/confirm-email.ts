import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { verifyJWT } from "better-auth/crypto";
import { z } from "zod";

/** The path the confirmation page posts to, under /api/auth. */
export const confirmEmailPath = "/confirm-email";

/** Why a confirmation didn't go through, as the answer's code. */
export type ConfirmFailure =
  "INVALID_LINK" | "CONFIRMED_ALREADY" | "WRONG_PASSWORD";

function refuse(
  status: "BAD_REQUEST" | "UNAUTHORIZED",
  code: ConfirmFailure,
): APIError {
  return new APIError(status, { code, message: code });
}

/**
 * Confirms an address from the link in its confirmation email, but only
 * with the password the account was created with. Anyone can sign up with
 * someone else's address, and the link goes to that address's owner. If a
 * click alone confirmed it, the owner would confirm an account whose
 * password someone else chose.
 *
 * The token's signature and age are checked first, so only someone holding
 * a real link learns anything about the account. It's a Better Auth
 * endpoint, so the router's origin check and the rate limit for this path
 * apply, as they do to signing in.
 */
export function confirmWithPassword() {
  return {
    id: "confirm-with-password",
    endpoints: {
      confirmEmailWithPassword: createAuthEndpoint(
        confirmEmailPath,
        {
          method: "POST",
          body: z.object({
            token: z.string().min(1).max(4096),
            password: z.string().min(1).max(128),
          }),
        },
        async (ctx) => {
          // Better Auth signed the token with the secret, and it expires.
          // A token for changing an address has no place here.
          const claims: unknown = await verifyJWT(
            ctx.body.token,
            ctx.context.secret,
          );
          const { email, updateTo } = (claims ?? {}) as {
            email?: unknown;
            updateTo?: unknown;
          };
          if (typeof email !== "string" || updateTo !== undefined) {
            throw refuse("BAD_REQUEST", "INVALID_LINK");
          }
          const found = await ctx.context.internalAdapter.findUserByEmail(
            email,
            { includeAccounts: true },
          );
          if (!found) throw refuse("BAD_REQUEST", "INVALID_LINK");
          if (found.user.emailVerified) {
            throw refuse("BAD_REQUEST", "CONFIRMED_ALREADY");
          }
          const hash = found.accounts.find(
            (account) => account.providerId === "credential",
          )?.password;
          if (
            !hash ||
            !(await ctx.context.password.verify({
              hash,
              password: ctx.body.password,
            }))
          ) {
            throw refuse("UNAUTHORIZED", "WRONG_PASSWORD");
          }
          const user = await ctx.context.internalAdapter.updateUser(
            found.user.id,
            { emailVerified: true },
          );
          const session = await ctx.context.internalAdapter.createSession(
            found.user.id,
          );
          await setSessionCookie(ctx, { session, user });
          return ctx.json({ status: true });
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}
