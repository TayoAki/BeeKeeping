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
