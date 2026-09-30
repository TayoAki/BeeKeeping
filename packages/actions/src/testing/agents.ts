// Agents for tests, made as an admin makes them: through the registry.
import type { Database } from "@beekeeping/db";

import type { AgentRole, AgentScope } from "../access/agents.ts";
import type { AgentPrincipal, Principal } from "../context.ts";
import { invokeAction } from "../registry/registry.ts";

/** A token for one of the admin's organization's agents. */
export async function issueToken(
  db: Database,
  admin: Principal,
  agentId: string,
  expiresInDays?: number,
) {
  const issued = await invokeAction(db, admin, "create_api_token", {
    agentId,
    expiresInDays,
  });
  if (!issued.ok) throw new Error(`No token: ${issued.reason}`);
  return issued;
}

/**
 * An agent of the admin's organization, with one token, and the principal
 * a door would build for it. Working agents' names differ within an
 * organization.
 */
export async function makeAgent(
  db: Database,
  admin: Principal,
  {
    name = "Bill runner (demo)",
    role = "bookkeeper",
    scope = "draft",
  }: { name?: string; role?: AgentRole; scope?: AgentScope } = {},
) {
  const made = await invokeAction(db, admin, "create_agent", {
    name,
    role,
    scope,
  });
  if (!made.ok) throw new Error(`No agent: ${made.reason}`);
  const { token, apiToken } = await issueToken(db, admin, made.agent.id);
  const principal: AgentPrincipal = {
    kind: "agent",
    orgId: admin.orgId,
    agentId: made.agent.id,
    role,
    scope,
  };
  return { agent: made.agent, token, apiToken, principal };
}
