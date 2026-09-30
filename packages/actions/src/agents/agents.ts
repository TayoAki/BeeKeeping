// Agents and their API tokens, which an organization's admins manage. Each
// of these is an admin action, so no agent reaches them, and migration
// 0004's people-only policies hide both tables from an agent's transaction
// as well. A token is shown once, in create_api_token's answer, and only
// its hash is kept.
import { agents, apiTokens } from "@beekeeping/db";
import { fail, ok, tokens } from "@beekeeping/services";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import {
  agentRoles,
  agentScopes,
  type AgentRole,
  type AgentScope,
} from "../access/agents.ts";
import { defineAction } from "../registry/define.ts";

const agentFields = z.object({
  id: z.string(),
  name: z.string(),
  role: z.enum(agentRoles),
  scope: z.enum(agentScopes),
  createdAt: z.string(),
  revokedAt: z.string().nullable(),
});

/** A token as lists show it: never the token, and never its hash. */
const tokenFields = z.object({
  id: z.string(),
  prefix: z.string(),
  createdAt: z.string(),
  expiresAt: z.string().nullable(),
  lastUsedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
});

/** The columns a token is listed by, so no query reads its hash. */
const tokenColumns = {
  id: apiTokens.id,
  agentId: apiTokens.agentId,
  prefix: apiTokens.prefix,
  createdAt: apiTokens.createdAt,
  expiresAt: apiTokens.expiresAt,
  lastUsedAt: apiTokens.lastUsedAt,
  revokedAt: apiTokens.revokedAt,
};

const iso = (time: Date | null) => time?.toISOString() ?? null;

function agentOutput(row: typeof agents.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    // The table's checks allow only these.
    role: row.role as AgentRole,
    scope: row.scope as AgentScope,
    createdAt: row.createdAt.toISOString(),
    revokedAt: iso(row.revokedAt),
  };
}

function tokenOutput(
  row: Pick<typeof apiTokens.$inferSelect, keyof typeof tokenColumns>,
) {
  return {
    id: row.id,
    prefix: row.prefix,
    createdAt: row.createdAt.toISOString(),
    expiresAt: iso(row.expiresAt),
    lastUsedAt: iso(row.lastUsedAt),
    revokedAt: iso(row.revokedAt),
  };
}

export const createAgent = defineAction({
  name: "create_agent",
  description:
    "Adds an agent to the organization: a name, the role it acts in (admin, bookkeeper or viewer) and its scope (read, draft or post). An agent acts only with an API token from create_api_token.",
  kind: "admin",
  role: "admin",
  approval: "never",
  input: z.object({
    name: z
      .string()
      .trim()
      .min(1, "Give the agent a name.")
      .max(80, "Keep the name to 80 characters.")
      .describe("What people will see in the audit log, such as Bill runner."),
    role: z
      .enum(agentRoles)
      .describe("The role it acts in, as a member in that role would."),
    scope: z
      .enum(agentScopes)
      .describe(
        "read calls read actions, draft adds drafts, and post adds posts, which a person may still have to approve.",
      ),
  }),
  output: z.object({ agent: agentFields }),
  run: async (ctx, input) => {
    const [made] = await ctx.tx
      .insert(agents)
      .values({
        orgId: ctx.orgId,
        name: input.name,
        role: input.role,
        scope: input.scope,
      })
      .onConflictDoNothing()
      .returning();
    if (!made) {
      return fail("name_taken", {
        message: "Another agent here has that name. Choose another.",
      });
    }
    return ok({ agent: agentOutput(made) });
  },
});

export const createApiToken = defineAction({
  name: "create_api_token",
  description:
    "Makes an API token for one of the organization's agents. The answer holds the token itself, the only time anyone sees it: BeeKeeping keeps only its hash.",
  kind: "admin",
  role: "admin",
  approval: "never",
  input: z.object({
    agentId: z.uuid("Choose an agent."),
    expiresInDays: z
      .number()
      .int()
      .min(1)
      .max(365)
      .optional()
      .describe(
        "Days until the token stops working. It never does unless given.",
      ),
  }),
  output: z.object({ token: z.string(), apiToken: tokenFields }),
  run: async (ctx, input) => {
    // The share lock waits for a revoke_agent already under way, then finds
    // the agent revoked, and holds off one that starts meanwhile until this
    // token is there for it to revoke.
    const [agent] = await ctx.tx
      .select({ id: agents.id })
      .from(agents)
      .where(
        and(
          eq(agents.orgId, ctx.orgId),
          eq(agents.id, input.agentId),
          isNull(agents.revokedAt),
        ),
      )
      .for("share");
    if (!agent) {
      return fail("not_found", {
        message: "There's no such agent here, or it has been revoked.",
      });
    }
    const made = tokens.newApiToken();
    const [row] = await ctx.tx
      .insert(apiTokens)
      .values({
        orgId: ctx.orgId,
        agentId: agent.id,
        tokenHash: made.hash,
        prefix: made.prefix,
        // Days of 24 hours, so the database's time zone changes nothing.
        expiresAt:
          input.expiresInDays === undefined
            ? null
            : sql`now() + make_interval(hours => ${input.expiresInDays * 24})`,
      })
      .returning(tokenColumns);
    if (!row) throw new Error("The token wasn't stored.");
    return ok({ token: made.token, apiToken: tokenOutput(row) });
  },
});

export const listAgents = defineAction({
  name: "list_agents",
  description:
    "Lists the organization's agents, working ones first, each with its API tokens: when each was made, last used, expires and was revoked. It never shows a token.",
  kind: "admin",
  role: "admin",
  approval: "never",
  input: z.object({}),
  output: z.object({
    agents: z.array(agentFields.extend({ tokens: z.array(tokenFields) })),
  }),
  run: async (ctx) => {
    const agentRows = await ctx.tx
      .select()
      .from(agents)
      .where(eq(agents.orgId, ctx.orgId))
      .orderBy(sql`${agents.revokedAt} is not null`, asc(agents.name));
    const tokenRows = await ctx.tx
      .select(tokenColumns)
      .from(apiTokens)
      .where(eq(apiTokens.orgId, ctx.orgId))
      .orderBy(asc(apiTokens.createdAt));
    const tokensOf = Map.groupBy(tokenRows, (token) => token.agentId);
    return ok({
      agents: agentRows.map((agent) => ({
        ...agentOutput(agent),
        tokens: (tokensOf.get(agent.id) ?? []).map(tokenOutput),
      })),
    });
  },
});

export const revokeApiToken = defineAction({
  name: "revoke_api_token",
  description:
    "Revokes one API token for good. The agent keeps any other tokens. Revoking a revoked token changes nothing.",
  kind: "admin",
  role: "admin",
  approval: "never",
  input: z.object({ tokenId: z.uuid("Choose a token.") }),
  output: z.object({}),
  run: async (ctx, input) => {
    const mine = and(
      eq(apiTokens.orgId, ctx.orgId),
      eq(apiTokens.id, input.tokenId),
    );
    const [token] = await ctx.tx
      .select({ id: apiTokens.id })
      .from(apiTokens)
      .where(mine);
    if (!token) {
      return fail("not_found", { message: "There's no such token here." });
    }
    // Postgres checks the condition again once it holds the row, so a
    // revoke that lands meanwhile leaves this one nothing to change.
    await ctx.tx
      .update(apiTokens)
      .set({ revokedAt: sql`now()` })
      .where(and(mine, isNull(apiTokens.revokedAt)));
    return ok({});
  },
});

export const revokeAgent = defineAction({
  name: "revoke_agent",
  description:
    "Revokes an agent and every token it has, for good. The audit log still names it. Revoking a revoked agent changes nothing.",
  kind: "admin",
  role: "admin",
  approval: "never",
  input: z.object({ agentId: z.uuid("Choose an agent.") }),
  output: z.object({}),
  run: async (ctx, input) => {
    const mine = and(eq(agents.orgId, ctx.orgId), eq(agents.id, input.agentId));
    const [agent] = await ctx.tx
      .select({ id: agents.id })
      .from(agents)
      .where(mine);
    if (!agent) {
      return fail("not_found", { message: "There's no such agent here." });
    }
    // As in revoke_api_token, a revoke that lands meanwhile wins.
    await ctx.tx
      .update(agents)
      .set({ revokedAt: sql`now()` })
      .where(and(mine, isNull(agents.revokedAt)));
    await ctx.tx
      .update(apiTokens)
      .set({ revokedAt: sql`now()` })
      .where(
        and(
          eq(apiTokens.orgId, ctx.orgId),
          eq(apiTokens.agentId, agent.id),
          isNull(apiTokens.revokedAt),
        ),
      );
    return ok({});
  },
});
