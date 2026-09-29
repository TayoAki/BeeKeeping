import type { Database, Transaction } from "@beekeeping/db";
import { sql } from "drizzle-orm";

import type { Role } from "./access/roles.ts";

/** Who an action acts for: a member of one organization, in their role. */
export type Principal = {
  readonly orgId: string;
  readonly userId: string;
  readonly role: Role;
};

/**
 * What every action gets: the principal, and the transaction it reads and
 * writes our tables through.
 */
export type ActionContext = Principal & { readonly tx: Transaction };

type Failure = { readonly ok: false };

function isFailure(value: unknown): value is Failure {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { ok?: unknown }).ok === false
  );
}

/**
 * What runAction throws when the database refuses a query: Postgres's error
 * code and constraint, never the query or its parameters, which Next.js
 * would write to its log.
 */
export class DatabaseRefusal extends Error {
  readonly code: string;
  readonly constraint: string | undefined;

  constructor(code: string, constraint: string | undefined) {
    super(`The database refused the action (${code}).`);
    this.name = "DatabaseRefusal";
    this.code = code;
    this.constraint = constraint;
  }
}

// Carries a failed result out of the transaction, so that it rolls back.
class Refusal extends Error {
  readonly result: Failure;

  constructor(result: Failure) {
    super("The action refused.");
    this.result = result;
  }
}

/**
 * Runs one action in a transaction of its own. The transaction sets app.org_id
 * and app.user_id with set local, so row-level security shows only the
 * principal's organization, and the settings end with the transaction. The
 * action's writes commit when it succeeds. When it returns a failure or
 * throws, they roll back. A query the database refuses comes out as a
 * DatabaseRefusal.
 */
export async function runAction<Outcome>(
  db: Database,
  principal: Principal,
  action: (ctx: ActionContext) => Promise<Outcome>,
): Promise<Outcome> {
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('app.org_id', ${principal.orgId}, true), set_config('app.user_id', ${principal.userId}, true)`,
      );
      const outcome = await action({ ...principal, tx });
      if (isFailure(outcome)) throw new Refusal(outcome);
      // A failed query that the action caught leaves the transaction
      // aborted, and COMMIT would then roll back without an error. This
      // query throws instead.
      await tx.execute(sql`select 1`);
      return outcome;
    });
  } catch (error) {
    if (error instanceof Refusal) return error.result as Outcome;
    // Drizzle's error holds the query and every parameter. Only Postgres's
    // code and constraint go on.
    const cause = (
      error as { cause?: { code?: unknown; constraint?: unknown } }
    ).cause;
    if (typeof cause?.code === "string") {
      throw new DatabaseRefusal(
        cause.code,
        typeof cause.constraint === "string" ? cause.constraint : undefined,
      );
    }
    throw error;
  }
}
