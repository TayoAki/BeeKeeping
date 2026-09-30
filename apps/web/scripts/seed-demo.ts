// Loads the demo company into DATABASE_URL's database. Staging and PR
// environments run it after the migrations, so each one opens on the demo
// company, and `pnpm dev:demo` runs it on this checkout's demo database.
// Running it again changes nothing, except a password that DEMO_PASSWORD
// has changed.
//
//   DATABASE_URL=... DEMO_PASSWORD=... pnpm seed:demo
//
// It needs DEMO_PASSWORD, which production never sets, and it refuses
// Railway's production environment whatever the settings say.
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { invokeAction } from "@beekeeping/actions";
import { openDatabase, type Database } from "@beekeeping/db";

import { createAuth, type Auth } from "../src/server/auth.ts";
import { demoCompany, type DemoRole } from "./demo-company.ts";

/** A refusal of the seed's own, whose message is safe to print. */
export class DemoSeedError extends Error {}

export type SeedResult = {
  /** What changed: nothing when the demo company was there already. */
  readonly changes: readonly string[];
  readonly organizationId: string;
};

/**
 * Loads the demo company, or finishes loading it, so running it twice
 * changes nothing. People and the organization go through Better Auth, as
 * sign-up and the new organization form do, and the home currency through
 * the set_up_organization action. A person whose password isn't
 * DEMO_PASSWORD any more gets it, so a rotated password takes effect at the
 * next deploy.
 */
export async function seedDemoCompany({
  auth,
  app,
  password,
}: {
  /** Better Auth, on a pool that runs as beekeeping_auth. */
  auth: Auth;
  /** A pool that runs as beekeeping_app, for the actions. */
  app: Database;
  password: string;
}): Promise<SeedResult> {
  const context = await auth.$context;
  // The lengths sign-up and sign-in allow, as auth.ts sets them.
  const { minPasswordLength, maxPasswordLength } = context.password.config;
  if (
    password.length < minPasswordLength ||
    password.length > maxPasswordLength
  ) {
    throw new DemoSeedError(
      `DEMO_PASSWORD needs ${minPasswordLength} to ${maxPasswordLength} characters.`,
    );
  }
  const changes: string[] = [];
  const userIds = new Map<DemoRole, string>();

  for (const person of demoCompany.people) {
    const found = await context.internalAdapter.findUserByEmail(person.email, {
      includeAccounts: true,
    });
    // Made by the system, as an admin would, with the address confirmed.
    const user =
      found?.user ??
      (await context.internalAdapter.createUser(
        { email: person.email, name: person.name, emailVerified: true },
        { method: "admin" },
      ));
    userIds.set(person.role, user.id);
    if (!found) changes.push(`added ${person.email}`);
    // The account sign-in reads the password from.
    const account = found?.accounts.find(
      (each) => each.providerId === "credential" && each.accountId === user.id,
    );
    if (!account) {
      await context.internalAdapter.linkAccount({
        userId: user.id,
        providerId: "credential",
        accountId: user.id,
        password: await context.password.hash(password),
      });
      if (found) changes.push(`gave ${person.email} a password`);
    } else if (
      !account.password ||
      !(await context.password.verify({ hash: account.password, password }))
    ) {
      // As a password reset does, nobody stays signed in on the old one.
      // Sessions go first: a run that stops before the new password is
      // set leaves nobody signed in, and the next run sets it.
      await context.internalAdapter.deleteUserSessions(user.id);
      await context.internalAdapter.updatePassword(
        user.id,
        await context.password.hash(password),
      );
      changes.push(`set the password of ${person.email}`);
    }
  }

  const ownerId = userIds.get("owner") ?? "";
  // Better Auth's own list endpoints want a signed-in person, so the seed
  // reads through its database adapter.
  let organization = await context.adapter.findOne<{ id: string }>({
    model: "organization",
    where: [{ field: "slug", value: demoCompany.slug }],
  });
  if (!organization) {
    organization = await auth.api.createOrganization({
      body: {
        name: demoCompany.name,
        slug: demoCompany.slug,
        userId: ownerId,
      },
    });
    if (!organization) {
      throw new DemoSeedError("Better Auth made no organization.");
    }
    changes.push(`added ${demoCompany.name}`);
  }
  const organizationId = organization.id;

  const members = await context.adapter.findMany<{ userId: string }>({
    model: "member",
    where: [{ field: "organizationId", value: organizationId }],
  });
  for (const person of demoCompany.people) {
    const userId = userIds.get(person.role) ?? "";
    if (members.some((member) => member.userId === userId)) continue;
    await auth.api.addMember({
      body: { userId, organizationId, role: person.role },
    });
    changes.push(`added ${person.email} as ${person.role}`);
  }

  const settings = await invokeAction(
    app,
    { orgId: organizationId, userId: ownerId, role: "owner" },
    "set_up_organization",
    { homeCurrency: demoCompany.homeCurrency },
  );
  if (settings.ok) {
    changes.push(`set the home currency to ${demoCompany.homeCurrency}`);
  } else if (settings.reason !== "already_set_up") {
    throw new DemoSeedError(
      `Setting up the demo company failed: ${settings.message}`,
    );
  }
  return { changes, organizationId };
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/**
 * What went wrong, without the error's message: a failed query's message
 * can carry its parameters, a password hash among them.
 */
function kindOf(error: unknown): string {
  if (!(error instanceof Error)) return "an error that isn't an Error";
  for (const each of [error, error.cause]) {
    const code = (each as { code?: unknown } | undefined)?.code;
    if (typeof code === "string") return `${error.name}, code ${code}`;
  }
  return error.name;
}

async function main() {
  if (process.env.RAILWAY_ENVIRONMENT_NAME === "production") {
    fail("The demo company never goes into production.");
  }
  const url =
    process.env.DATABASE_URL || fail("Set DATABASE_URL, the app's login.");
  const password =
    process.env.DEMO_PASSWORD ||
    fail("Set DEMO_PASSWORD, the demo people's password.");

  // The seed sends no email and signs nobody in, so a throwaway outbox and
  // secret do. It signs in as the app does: Better Auth as beekeeping_auth,
  // the actions as beekeeping_app.
  const outbox = mkdtempSync(join(tmpdir(), "beekeeping-seed-"));
  const authPool = openDatabase(url, { role: "auth", max: 2 });
  const appPool = openDatabase(url, { max: 2 });
  try {
    const { changes } = await seedDemoCompany({
      auth: createAuth({
        db: authPool.db,
        secret: randomBytes(32).toString("hex"),
        baseUrl: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
        transport: { kind: "outbox", dir: outbox, from: demoCompany.emailFrom },
        rateLimit: false,
      }),
      app: appPool.db,
      password,
    });
    console.log(
      changes.length === 0
        ? `${demoCompany.name} is loaded already.`
        : `Loaded ${demoCompany.name}: ${changes.join(", ")}.`,
    );
  } catch (error) {
    process.exitCode = 1;
    console.error(
      error instanceof DemoSeedError
        ? error.message
        : `Loading ${demoCompany.name} failed (${kindOf(error)}). Its message stays out of the log, since it can hold a password hash.`,
    );
  } finally {
    await authPool.close();
    await appPool.close();
    rmSync(outbox, { recursive: true, force: true });
  }
}

if (process.argv[1] === import.meta.filename) await main();
