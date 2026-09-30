import { agents, auditEvents } from "@beekeeping/db";
import { ok } from "@beekeeping/services";
import { and, desc, eq, gte, inArray, lt, sql, type SQL } from "drizzle-orm";
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
 * The agents a list of events names, as the acting agent or as a token's
 * agent. The log keeps only their ids.
 */
function agentIdsOf(
  events: readonly {
    actorAgentId: string | null;
    tableName: string;
    changes: unknown;
  }[],
): string[] {
  const ids = new Set<string>();
  for (const event of events) {
    if (event.actorAgentId !== null) ids.add(event.actorAgentId);
    const agentId = (event.changes as Record<string, unknown>).agent_id;
    if (event.tableName === "api_tokens" && typeof agentId === "string") {
      ids.add(agentId);
    }
  }
  return [...ids];
}

/**
 * The audit log's newest events, for an admin: who changed what, when, and
 * the fields the table lists, with the names of the agents they name.
 * Postgres triggers write the log, so this reads it and nothing writes it.
 * It's an admin action, so no agent reads the log: it copies what agents
 * never see, such as agents and API tokens.
 */
export const listAuditEvents = defineAction({
  name: "list_audit_events",
  description:
    "Lists the newest events in the organization's audit log: who changed what and when, with the fields each table lists and the names of the agents it names. Filters by table, by kind of change and by day.",
  kind: "admin",
  role: "admin",
  approval: "never",
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
        actorAgentId: z.string().nullable(),
        approvedByUserId: z.string().nullable(),
        tableName: z.string(),
        recordId: z.string(),
        action: z.enum(changeKinds),
        changes: z.record(z.string(), z.unknown()),
      }),
    ),
    /** Every table the organization's log names, for a filter. */
    tables: z.array(z.string()),
    /** The agents these events name, acting or as a token's agent. */
    agents: z.array(z.object({ id: z.string(), name: z.string() })),
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
    // Agents are revoked, never deleted, so each id has its name.
    const agentIds = agentIdsOf(rows);
    const named =
      agentIds.length === 0
        ? []
        : await ctx.tx
            .select({ id: agents.id, name: agents.name })
            .from(agents)
            .where(
              and(eq(agents.orgId, ctx.orgId), inArray(agents.id, agentIds)),
            );
    return ok({
      events: rows.map((row) => ({
        id: row.id,
        occurredAt: row.occurredAt.toISOString(),
        actorUserId: row.actorUserId,
        actorAgentId: row.actorAgentId,
        approvedByUserId: row.approvedByUserId,
        tableName: row.tableName,
        recordId: row.recordId,
        action: row.action as (typeof changeKinds)[number],
        changes: row.changes as Record<string, unknown>,
      })),
      tables: tables.rows.map(({ table_name }) => table_name),
      agents: named,
    });
  },
});
