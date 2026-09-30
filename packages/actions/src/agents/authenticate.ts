import type { Database } from "@beekeeping/db";
import { tokens } from "@beekeeping/services";
import { sql } from "drizzle-orm";

import { isAgentRole, isAgentScope } from "../access/agents.ts";
import { withoutQuery, type AgentPrincipal } from "../context.ts";

/**
 * The agent a presented API token acts for, or undefined for any token that
 * doesn't work: one that's unknown, revoked or expired, one whose agent is
 * revoked, and text that can't be a token. A door calls this, then
 * invokeAction with the answer, so the token decides the organization, the
 * role and the scope, and the request decides none of them.
 *
 * It runs before any organization is known, so it asks the one database
 * function made for it, authenticate_api_token, which answers only for the
 * hash it's given. When the database fails, it throws as runAction does,
 * never with the query, whose parameter is the hash.
 */
export async function authenticateApiToken(
  db: Database,
  presented: string,
): Promise<AgentPrincipal | undefined> {
  const hashed = tokens.apiTokenHash(presented);
  if (!hashed.ok) return undefined;
  const found = await db
    .execute<{
      org_id: string;
      agent_id: string;
      role: string;
      scope: string;
    }>(
      sql`select org_id, agent_id, role, scope from authenticate_api_token(${hashed.hash})`,
    )
    .catch((error: unknown) => {
      throw withoutQuery(error);
    });
  const [row] = found.rows;
  if (!row || !isAgentRole(row.role) || !isAgentScope(row.scope)) {
    return undefined;
  }
  return {
    kind: "agent",
    orgId: row.org_id,
    agentId: row.agent_id,
    role: row.role,
    scope: row.scope,
  };
}
