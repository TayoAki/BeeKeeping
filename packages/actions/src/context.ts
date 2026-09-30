import type { Database, Transaction } from "@beekeeping/db";
import { DrizzleQueryError, sql } from "drizzle-orm";

import type { AgentRole, AgentScope } from "./access/agents.ts";
import type { Role } from "./access/roles.ts";

/** A member of one organization, acting in their role. */
export type PersonPrincipal = {
  readonly kind: "person";
  readonly orgId: string;
  readonly userId: string;
  readonly role: Role;
};

/**
 * An agent of one organization, acting in its role and within its scope.
 * approvedBy is the id of the person who approved this call, when one had
 * to. Nothing sets it before P1.12's approvals.
 */
export type AgentPrincipal = {
  readonly kind: "agent";
  readonly orgId: string;
  readonly agentId: string;
  readonly role: AgentRole;
  readonly scope: AgentScope;
  readonly approvedBy?: string;
};

/** Who an action acts for: a person or an agent, in one organization. */
export type Principal = PersonPrincipal | AgentPrincipal;

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

/**
 * pg's own reasons for a connection or a pool that failed. They're fixed
 * text, with no query and no value in them.
 */
const driverReasons =
  /^(timeout exceeded when trying to connect|Connection terminated( unexpectedly| due to connection timeout)?|Query read timeout|Client (has encountered a connection error|was closed) and is not queryable|Cannot use a pool after calling end on the pool)$/;

/**
 * An error to throw in place of a failed query's. Drizzle's holds the query
 * and every parameter, such as a token's hash, so only Postgres's code and
 * constraint go on, in a DatabaseRefusal. A query that failed with no code,
 * such as one whose connection dropped, goes on as a plain error that keeps
 * only a reason pg words itself. Any other error goes on as it is.
 */
export function withoutQuery(error: unknown): unknown {
  const cause = (error as { cause?: { code?: unknown; constraint?: unknown } })
    .cause;
  if (typeof cause?.code === "string") {
    return new DatabaseRefusal(
      cause.code,
      typeof cause.constraint === "string" ? cause.constraint : undefined,
    );
  }
  if (error instanceof DrizzleQueryError) {
    const reason =
      cause instanceof Error && driverReasons.test(cause.message)
        ? `: ${cause.message}`
        : "";
    return new Error(`A query failed before the database answered${reason}.`);
  }
  return error;
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
 * with set local, so row-level security shows only the principal's
 * organization, and app.user_id or app.agent_id, with app.approver_id, so
 * the audit log names who acted. The settings end with the transaction.
 * The action's writes commit when it succeeds. When it returns a failure or
 * throws, they roll back. A failed query comes out without the query, as
 * withoutQuery says.
 */
export async function runAction<Outcome>(
  db: Database,
  principal: Principal,
  action: (ctx: ActionContext) => Promise<Outcome>,
): Promise<Outcome> {
  try {
    return await db.transaction(async (tx) => {
      const person = principal.kind === "person" ? principal : undefined;
      const agent = principal.kind === "agent" ? principal : undefined;
      await tx.execute(
        sql`select set_config('app.org_id', ${principal.orgId}, true),
                   set_config('app.user_id', ${person?.userId ?? ""}, true),
                   set_config('app.agent_id', ${agent?.agentId ?? ""}, true),
                   set_config('app.approver_id', ${agent?.approvedBy ?? ""}, true)`,
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
    throw withoutQuery(error);
  }
}
