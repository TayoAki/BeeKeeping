import { auditEvents } from "@beekeeping/db";
import { ok } from "@beekeeping/services";
import { and, desc, eq, gte, lt, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { defineAction } from "../registry/define.ts";

const changeKinds = ["insert", "update", "delete"] as const;

/**
 * A day as YYYY-MM-DD, in UTC. A date in year 0 or past 9999-12-30 (whose
 * next day is in year 10000) reaches Postgres in a form it refuses, so the
 * input stops those here.
 */
const day = z.iso
  .date()
  .refine((value) => value >= "0001-01-01" && value <= "9999-12-30", {
    message: "Choose a day from 0001-01-01 to 9999-12-30.",
  });

/** The start of the day after a YYYY-MM-DD date, in UTC. */
function dayAfter(date: string): Date {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

/**
 * The audit log's newest events, for an admin: who changed what, when, and
 * the fields the table lists. Postgres triggers write the log, so this
 * reads it and nothing writes it.
 */
export const listAuditEvents = defineAction({
  name: "list_audit_events",
  description:
    "Lists the newest events in the organization's audit log: who changed what and when, with the fields each table lists. Filters by table, by kind of change and by day.",
  kind: "read",
  role: "admin",
  approval: "none",
  input: z.object({
    table: z
      .string()
      .max(63)
      .regex(/^[a-z_][a-z0-9_]*$/, {
        message: "Use a table's name, such as organization_settings.",
      })
      .optional()
      .describe("Only this table's events, such as organization_settings."),
    action: z
      .enum(changeKinds)
      .optional()
      .describe("Only inserts, updates or deletes."),
    from: day
      .optional()
      .describe("The first day to include, as YYYY-MM-DD in UTC."),
    to: day
      .optional()
      .describe("The last day to include, as YYYY-MM-DD in UTC."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(500)
      .optional()
      .describe(
        "How many events, newest first: 100 unless given, 500 at most.",
      ),
  }),
  output: z.object({
    events: z.array(
      z.object({
        id: z.string(),
        occurredAt: z.string(),
        actorUserId: z.string().nullable(),
        tableName: z.string(),
        recordId: z.string(),
        action: z.enum(changeKinds),
        changes: z.record(z.string(), z.unknown()),
      }),
    ),
    /** Every table the organization's log names, for a filter. */
    tables: z.array(z.string()),
  }),
  run: async (ctx, input) => {
    const filters: SQL[] = [eq(auditEvents.orgId, ctx.orgId)];
    if (input.table) filters.push(eq(auditEvents.tableName, input.table));
    if (input.action) filters.push(eq(auditEvents.action, input.action));
    if (input.from) {
      filters.push(
        gte(auditEvents.occurredAt, new Date(`${input.from}T00:00:00Z`)),
      );
    }
    if (input.to) filters.push(lt(auditEvents.occurredAt, dayAfter(input.to)));
    const rows = await ctx.tx
      .select()
      .from(auditEvents)
      .where(and(...filters))
      .orderBy(desc(auditEvents.occurredAt), desc(auditEvents.seq))
      .limit(input.limit ?? 100);
    // The log only grows, so rather than read all of it for a few names,
    // this asks the (org_id, table_name) index for each next name in turn.
    const tables = await ctx.tx.execute<{ table_name: string }>(sql`
      with recursive names(table_name) as (
        (select table_name from audit_events
          where org_id = ${ctx.orgId}
          order by table_name limit 1)
        union all
        select (select later.table_name from audit_events later
                 where later.org_id = ${ctx.orgId}
                   and later.table_name > names.table_name
                 order by later.table_name limit 1)
          from names
         where names.table_name is not null
      )
      select table_name from names where table_name is not null`);
    return ok({
      events: rows.map((row) => ({
        id: row.id,
        occurredAt: row.occurredAt.toISOString(),
        actorUserId: row.actorUserId,
        tableName: row.tableName,
        recordId: row.recordId,
        action: row.action as (typeof changeKinds)[number],
        changes: row.changes as Record<string, unknown>,
      })),
      tables: tables.rows.map(({ table_name }) => table_name),
    });
  },
});
