// Agents and their API tokens. An agent is a principal of one organization,
// like a member, with a role and a scope, and the audit log names it for
// what it changes, as it names who made and revoked each agent and token.
// An API token lets a headless agent act without a sign-in. Only the
// token's SHA-256 is stored, and the app can't read even that: only
// authenticate_api_token, the one lookup that runs before an organization
// is known, compares it. Neither table loses a row: revoking ends an agent
// or a token, for good, and the log can always name the agent. Migration
// 0004 holds the grants, the triggers and the functions.
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { organizations } from "./auth.ts";
import { orgIsolation, peopleOnly } from "./tenancy.ts";

export const agents = pgTable(
  "agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** What it may do, as a member in that role may: never owner. */
    role: text("role").notNull(),
    /** Which kinds of action it may call: read, draft or post. */
    scope: text("scope").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    // For api_tokens' foreign key, which keeps a token in its agent's
    // organization.
    unique("agents_org_id_id").on(table.orgId, table.id),
    // One working agent per name, so the log's names stay clear.
    uniqueIndex("agents_org_name")
      .on(table.orgId, sql`lower(${table.name})`)
      .where(sql`${table.revokedAt} is null`),
    check(
      "agents_name_check",
      sql`char_length(btrim(${table.name})) between 1 and 80`,
    ),
    check(
      "agents_role_check",
      sql`${table.role} in ('admin', 'bookkeeper', 'viewer')`,
    ),
    check(
      "agents_scope_check",
      sql`${table.scope} in ('read', 'draft', 'post')`,
    ),
    orgIsolation("agents", table.orgId),
    // Agents never make, read or revoke agents.
    peopleOnly("agents"),
  ],
);

export const apiTokens = pgTable(
  "api_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    agentId: uuid("agent_id").notNull(),
    /** The token's SHA-256, in hex. The token itself is never stored. */
    tokenHash: text("token_hash").notNull().unique(),
    /** The token's first characters, so a person can tell tokens apart. */
    prefix: text("prefix").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** After this the token stops working. None means it doesn't expire. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    /** When it last worked, to the minute. */
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      name: "api_tokens_agent_fk",
      columns: [table.orgId, table.agentId],
      foreignColumns: [agents.orgId, agents.id],
    }).onDelete("cascade"),
    index("api_tokens_agent").on(table.orgId, table.agentId),
    check("api_tokens_hash_check", sql`${table.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check(
      "api_tokens_prefix_check",
      sql`${table.prefix} ~ '^bk_[A-Za-z0-9_-]{7}$'`,
    ),
    check(
      "api_tokens_expiry_check",
      sql`${table.expiresAt} is null or ${table.expiresAt} > ${table.createdAt}`,
    ),
    orgIsolation("api_tokens", table.orgId),
    // Agents never make, read or revoke tokens.
    peopleOnly("api_tokens"),
  ],
);
