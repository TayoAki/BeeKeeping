// The audit log: who changed what in an organization's tables. Postgres
// triggers write it, each copying only the fields its table lists, so a
// secret field never enters it. The app reads only its own organization's
// events and can add, change or remove none. UPDATE, DELETE and TRUNCATE
// are refused for every role, the owner's included. Only the owner, which
// migrations and test setup log in as, can add a row directly or turn that
// refusal off. Migration 0003 holds the trigger function, the triggers and
// the rules that keep the log unchanged. 0004 adds the agent and the
// approver, whose columns default to the transaction's settings, so the
// trigger function fills them without naming them.
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { orgIsolation } from "./tenancy.ts";

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // No foreign key: the log outlives what it describes.
    orgId: uuid("org_id").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /**
     * The order the events were written in. The events of one transaction
     * share occurred_at, the time it started, so this orders them.
     */
    seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity(),
    /**
     * The person the transaction acted for, from app.user_id. Null when no
     * person did, such as a migration or an agent.
     */
    actorUserId: uuid("actor_user_id"),
    /** The agent the transaction acted for, from app.agent_id. */
    actorAgentId: uuid("actor_agent_id").default(sql`current_agent_id()`),
    /**
     * The person who approved an agent's change, from app.approver_id.
     * Null when nobody had to.
     */
    approvedByUserId: uuid("approved_by_user_id").default(
      sql`current_approver_id()`,
    ),
    tableName: text("table_name").notNull(),
    /** The changed row's key, as text. */
    recordId: text("record_id").notNull(),
    action: text("action").notNull(),
    /**
     * Only the fields the table's trigger lists: an insert's values, an
     * update's changed fields as [old, new], and a delete's old values.
     */
    changes: jsonb("changes").notNull(),
  },
  (table) => [
    // Newest first: by time, then by the order written.
    index("audit_events_org_time").on(table.orgId, table.occurredAt, table.seq),
    // The tables an organization's log names, read one probe per name.
    index("audit_events_org_table").on(table.orgId, table.tableName),
    check(
      "audit_events_action_check",
      sql`${table.action} in ('insert', 'update', 'delete')`,
    ),
    orgIsolation("audit_events", table.orgId),
  ],
);
