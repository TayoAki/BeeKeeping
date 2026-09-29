import { AsyncLocalStorage } from "node:async_hooks";

import {
  accessControl,
  authEmails,
  isOrganizationName,
  isPersonName,
  isRole,
  mayChangeRole,
  mayInviteAs,
  mayRemove,
  maySignInByLink,
  organizationNameLimit,
  organizationRoles,
  personNameLimit,
  startingOrganization,
  type EmailContent,
} from "@beekeeping/actions";
import { authSchema, openDatabase, type Database } from "@beekeeping/db";
import { email } from "@beekeeping/services";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware, isAPIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { magicLink, organization, twoFactor } from "better-auth/plugins";
import { z } from "zod";

import { confirmEmailPath, confirmWithPassword } from "./confirm-email.ts";
import { readServerEnv } from "./env.ts";

export type AuthConfig = {
  readonly db: Database;
  readonly secret: string;
  readonly baseUrl: string;
  readonly transport: email.EmailTransport;
  /** Off in tests that sign in many times from one address. */
  readonly rateLimit: boolean;
};

const minute = 60;
const day = 24 * 60 * minute;

// Railway's edge proxy puts the visitor's address in X-Real-IP, replacing
// whatever the visitor sent, so every rate limit keys on the visitor.
const clientAddressHeader = "x-real-ip";

// Better Auth sends the confirmation and invitation emails through a helper
// that logs a failure and carries on, so the request would still answer 200.
// Each request records a failed email here, and handleAuthRequest turns the
// answer into a 503 instead.
const emailFailures = new AsyncLocalStorage<{ failed: boolean }>();

const emailNotSent = "We couldn't send the email. Try again in a minute.";

/**
 * Better Auth's log lines, with only their first line and an error code. A
 * failed query's full message and error carry its parameters, such as
 * session tokens and password hashes. Better Auth sometimes passes the
 * error itself as the message.
 */
export function logAuth(
  level: string,
  message: unknown,
  ...details: unknown[]
) {
  const error = [message, ...details].find(
    (detail) => detail instanceof Error,
  ) as (Error & { code?: string; cause?: { code?: string } }) | undefined;
  const code = error?.cause?.code ?? error?.code ?? error?.name;
  const text = typeof message === "string" ? message.split("\n")[0] : "";
  const line = `auth ${level}: ${text ?? ""}${code ? ` (${code})` : ""}`;
  if (level === "error") console.error(line);
  else console.warn(line);
}

/**
 * Better Auth, set up for BeeKeeping: email and password with confirmed
 * addresses, magic links for accounts that exist, two-factor codes with
 * backup codes, organizations with the four roles, and sessions kept in
 * Postgres so that ending one takes effect at once.
 */
export function createAuth(config: AuthConfig) {
  async function deliver(to: string, content: EmailContent): Promise<void> {
    const sent = await email.send(config.transport, { to, ...content });
    if (sent.ok) return;
    const state = emailFailures.getStore();
    if (state) state.failed = true;
    throw new APIError("SERVICE_UNAVAILABLE", { message: emailNotSent });
  }

  /** For an address with no account: a note that points to sign-up. */
  const noAccountNote = (to: string) =>
    deliver(to, authEmails.noAccount({ url: `${config.baseUrl}/sign-up` }));

  /**
   * The confirmation page for Better Auth's verify-email link. The page asks
   * for the account's password before it confirms the address, and keeps
   * where the person was going.
   */
  function confirmationPage(url: string, token: string): string {
    const page = new URL("/confirm-email", config.baseUrl);
    page.searchParams.set("token", token);
    page.searchParams.set(
      "next",
      new URL(url).searchParams.get("callbackURL") ?? "/",
    );
    return page.href;
  }

  return betterAuth({
    appName: "BeeKeeping",
    baseURL: config.baseUrl,
    secret: config.secret,
    // A sign-up writes a user and their password together, or neither.
    database: drizzleAdapter(config.db, {
      provider: "pg",
      schema: authSchema,
      usePlural: true,
      transaction: true,
    }),
    logger: { log: logAuth },
    // An error Better Auth didn't expect, such as a failed query, is thrown
    // to handleAuthRequest instead of printed whole: its message and cause
    // carry the query's parameters, such as a session token. One path still
    // prints: when a read of a joined row fails, such as a user's accounts,
    // Better Auth's adapter prints the error, query and parameters included,
    // before it throws. Those parameters are ids from a row already read.
    onAPIError: { throw: true },
    // Reset links are stored as a hash, so a copy of the table resets
    // nobody's password.
    verification: {
      storeIdentifier: {
        default: "plain",
        overrides: { "reset-password:": "hashed" },
      },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      // Someone signing up again with the address gets a note instead of a
      // second account. Either way an email goes out, and a failed one
      // answers 503, so the form doesn't reveal who has an account.
      onExistingUserSignUp: ({ user }) =>
        deliver(
          user.email,
          authEmails.existingAccount({ url: `${config.baseUrl}/sign-in` }),
        ),
      // A forgotten password. The link works once, for 30 minutes, and a
      // new password ends every session. Two-factor still asks for its
      // code, and a reset also gives back a password Better Auth removed
      // when a link proved an unconfirmed address.
      sendResetPassword: ({ user, url }) =>
        deliver(user.email, authEmails.resetPassword({ url })),
      resetPasswordTokenExpiresIn: 30 * minute,
      revokeSessionsOnPasswordReset: true,
    },
    emailVerification: {
      sendOnSignUp: true,
      // The right password on an address that isn't confirmed sends a new
      // link, since the first one lasts an hour.
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: ({ user, url, token }) =>
        deliver(
          user.email,
          authEmails.verifyEmail({ url: confirmationPage(url, token) }),
        ),
    },
    session: {
      expiresIn: 7 * day,
      updateAge: day,
      // Every request reads the session from Postgres, so removing a member
      // or signing out everywhere ends their access immediately.
      cookieCache: { enabled: false },
    },
    // Nothing in the app calls these. The right password on an address that
    // isn't confirmed sends a new link, and a failed send from the public
    // endpoint would single out unconfirmed accounts. A confirmation link
    // opens the page at /confirm-email, which confirms through the
    // confirm-with-password endpoint, so a click alone confirms nothing.
    disabledPaths: ["/send-verification-email", "/verify-email"],
    hooks: {
      // A person's name goes into invitation emails, so it has a limit. The
      // check comes before Better Auth looks up the address, so an address
      // with an account and one without get the same answer.
      before: createAuthMiddleware((ctx) => {
        if (ctx.path !== "/sign-up/email" && ctx.path !== "/update-user") {
          return Promise.resolve();
        }
        const name: unknown = (ctx.body as { name?: unknown } | undefined)
          ?.name;
        if (ctx.path === "/update-user" && name === undefined) {
          return Promise.resolve();
        }
        if (!isPersonName(name)) {
          throw new APIError("BAD_REQUEST", {
            message: `Give a name of up to ${personNameLimit} characters.`,
          });
        }
        return Promise.resolve();
      }),
      // Better Auth answers a reset for an address with no account without
      // sending anything, so the answer would come back sooner. A note
      // goes out instead, and the timing matches. It goes out only after
      // Better Auth has accepted the request, so a request it refuses sends
      // nothing and takes as long for every address.
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/request-password-reset") return;
        if (isAPIError(ctx.context.returned)) return;
        const to: unknown = (ctx.body as { email?: unknown } | undefined)
          ?.email;
        if (typeof to !== "string" || !z.email().safeParse(to).success) return;
        if (!(await ctx.context.internalAdapter.findUserByEmail(to))) {
          await noAccountNote(to);
        }
      }),
    },
    databaseHooks: {
      session: {
        create: {
          before: async (session, context) => {
            if (!context) return undefined;
            if (context.path === "/magic-link/verify") {
              const user = await context.context.internalAdapter.findUserById(
                session.userId,
              );
              if (!maySignInByLink(user)) return false;
            }
            const memberships = await context.context.adapter.findMany<{
              organizationId: string;
            }>({
              model: "member",
              where: [{ field: "userId", value: session.userId }],
              limit: 2,
            });
            const organizationId = startingOrganization(memberships);
            return organizationId
              ? { data: { ...session, activeOrganizationId: organizationId } }
              : undefined;
          },
        },
      },
    },
    rateLimit: {
      enabled: config.rateLimit,
      storage: "database",
      window: minute,
      max: 100,
      customRules: {
        "/sign-in/email": { window: minute, max: 5 },
        "/sign-up/email": { window: minute, max: 5 },
        "/sign-in/magic-link": { window: minute, max: 5 },
        "/two-factor/verify-totp": { window: minute, max: 5 },
        "/two-factor/verify-backup-code": { window: minute, max: 5 },
        // Better Auth's own limit for resets, which a custom rule replaces.
        "/request-password-reset": { window: minute, max: 3 },
        "/reset-password": { window: minute, max: 5 },
        [confirmEmailPath]: { window: minute, max: 5 },
        // Invitations go out from BeeKeeping's address with names the
        // inviter typed, so each address sends only a few.
        "/organization/invite-member": { window: minute, max: 10 },
        "/organization/create": { window: minute, max: 5 },
      },
    },
    advanced: {
      database: { generateId: "uuid" },
      ipAddress: { ipAddressHeaders: [clientAddressHeader] },
      // Better Auth skips its origin and callback checks under a test runner
      // unless told otherwise, and the tests should see what production does.
      disableOriginCheck: false,
    },
    plugins: [
      organization({
        ac: accessControl,
        roles: organizationRoles,
        creatorRole: "owner",
        // Deleting an organization arrives with the retention job in P8.5.
        disableOrganizationDeletion: true,
        invitationExpiresIn: 7 * day,
        cancelPendingInvitationsOnReInvite: true,
        requireEmailVerificationOnInvitation: true,
        sendInvitationEmail: ({ id, email: to, role, organization, inviter }) =>
          deliver(
            to,
            authEmails.invitation({
              url: `${config.baseUrl}/invitations/${id}`,
              organizationName: organization.name,
              inviterName: inviter.user.name,
              role: isRole(role) ? role : "viewer",
            }),
          ),
        organizationHooks: {
          beforeCreateOrganization: ({ organization }) => {
            if (!isOrganizationName(organization.name)) {
              throw new APIError("BAD_REQUEST", {
                message: `Give the business a name of up to ${organizationNameLimit} characters.`,
              });
            }
            return Promise.resolve();
          },
          beforeUpdateOrganization: ({ organization }) => {
            if (
              organization.name !== undefined &&
              !isOrganizationName(organization.name)
            ) {
              throw new APIError("BAD_REQUEST", {
                message: `Give the business a name of up to ${organizationNameLimit} characters.`,
              });
            }
            return Promise.resolve();
          },
          beforeCreateInvitation: ({ invitation }) => {
            if (!mayInviteAs(invitation.role)) {
              throw new APIError("BAD_REQUEST", {
                message:
                  "Invite someone as an admin, a bookkeeper or a viewer.",
              });
            }
            return Promise.resolve();
          },
          beforeUpdateMemberRole: ({ member, newRole }) => {
            if (!mayChangeRole(member.role, newRole)) {
              throw new APIError("FORBIDDEN", {
                message: "An owner's role can't change here.",
              });
            }
            return Promise.resolve();
          },
          beforeRemoveMember: ({ member }) => {
            if (!mayRemove(member.role)) {
              throw new APIError("FORBIDDEN", {
                message: "An owner can't be removed.",
              });
            }
            return Promise.resolve();
          },
        },
      }),
      twoFactor({ issuer: "BeeKeeping" }),
      magicLink({
        expiresIn: 10 * minute,
        // New people sign up with a password. A link only signs in an
        // account that exists.
        disableSignUp: true,
        // The table keeps a hash, so a copy of it signs nobody in.
        storeToken: "hashed",
        // Someone with two-factor on gets no link, only a note to sign in
        // with their password and code, and an address with no account
        // gets a note that points to sign-up. Everyone gets the same
        // answer, so the form doesn't reveal who has an account or
        // two-factor on.
        sendMagicLink: async ({ email: to, url }, context) => {
          const found = context
            ? await context.context.internalAdapter.findUserByEmail(to)
            : null;
          if (!found) {
            await noAccountNote(to);
            return;
          }
          await deliver(
            to,
            maySignInByLink(found.user)
              ? authEmails.magicLink({ url })
              : authEmails.useTwoFactorSignIn({
                  url: `${config.baseUrl}/sign-in`,
                }),
          );
        },
      }),
      confirmWithPassword(),
      // Lets server actions set the session cookie. It must come last.
      nextCookies(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

/**
 * Serves one request to /api/auth. When an email the request should have
 * sent failed, the answer is a 503 that says so, whatever Better Auth
 * answered. Every address gets the same 503, so it reveals nothing.
 */
export async function handleAuthRequest(
  auth: Auth,
  request: Request,
): Promise<Response> {
  const state = { failed: false };
  let response: Response;
  try {
    response = await emailFailures.run(state, () => auth.handler(request));
  } catch (error) {
    // Only a code goes to the log. The error carries the failed query and
    // its parameters.
    logAuth("error", "request failed", error);
    return Response.json(
      {
        code: "INTERNAL_SERVER_ERROR",
        message: "Something went wrong on our side. Try again in a minute.",
      },
      { status: 500 },
    );
  }
  if (!state.failed) return response;
  return Response.json(
    { code: "EMAIL_NOT_SENT", message: emailNotSent },
    { status: 503 },
  );
}

let instance: Auth | undefined;

/** The app's Better Auth, built from the environment on first use. */
export function getAuth(): Auth {
  if (!instance) {
    const env = readServerEnv(process.env);
    instance = createAuth({
      db: openDatabase(env.DATABASE_URL).db,
      secret: env.BETTER_AUTH_SECRET,
      baseUrl: env.BETTER_AUTH_URL,
      transport: env.RESEND_API_KEY
        ? { kind: "resend", apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM }
        : {
            kind: "outbox",
            dir: env.BEEKEEPING_OUTBOX_DIR,
            from: env.EMAIL_FROM,
          },
      rateLimit: env.NODE_ENV === "production",
    });
  }
  return instance;
}
