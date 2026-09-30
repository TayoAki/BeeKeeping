import { sql } from "drizzle-orm";
import { pgPolicy, type AnyPgColumn } from "drizzle-orm/pg-core";

import { appRole, authRole } from "./roles.ts";

/**
 * The row-level security policy for a table that holds organizations' rows:
 * the app sees and writes only the rows of the organization its transaction
 * set in app.org_id. With no organization set, it sees nothing.
 */
export function orgIsolation(table: string, orgId: AnyPgColumn) {
  return pgPolicy(`${table}_org_isolation`, {
    as: "permissive",
    for: "all",
    to: appRole,
    using: sql`${orgId} = (select current_org_id())`,
    withCheck: sql`${orgId} = (select current_org_id())`,
  });
}

/** The policy for one of sign-in's tables: Better Auth's role only. */
export function authOnly(table: string) {
  return pgPolicy(`${table}_auth_only`, {
    as: "permissive",
    for: "all",
    to: authRole,
    using: sql`true`,
    withCheck: sql`true`,
  });
}

/**
 * A second policy for a table that only people may use, such as agents and
 * their tokens: with an agent in app.agent_id, the app sees and writes
 * nothing there, whatever the organization. Migration 0004 makes
 * current_agent_id().
 */
export function peopleOnly(table: string) {
  return pgPolicy(`${table}_people_only`, {
    as: "restrictive",
    for: "all",
    to: appRole,
    using: sql`(select current_agent_id()) is null`,
    withCheck: sql`(select current_agent_id()) is null`,
  });
}
