// What an agent may be given. An agent acts as a member in its role would,
// and its scope says which kinds of action it may call at all.
import type { ActionKind } from "../registry/define.ts";
import type { Role } from "./roles.ts";

/** An agent's roles: any a member may hold but owner. */
export const agentRoles = [
  "admin",
  "bookkeeper",
  "viewer",
] as const satisfies readonly Role[];
export type AgentRole = (typeof agentRoles)[number];

/** An agent's scopes, narrowest first. */
export const agentScopes = ["read", "draft", "post"] as const;
export type AgentScope = (typeof agentScopes)[number];

/**
 * The kinds of action each scope reaches. Draft adds drafts to reads, and
 * post adds posts. No scope reaches an admin action.
 */
const kindsFor: Readonly<Record<AgentScope, readonly ActionKind[]>> = {
  read: ["read"],
  draft: ["read", "draft"],
  post: ["read", "draft", "post"],
};

export function isAgentRole(value: unknown): value is AgentRole {
  return agentRoles.some((role) => role === value);
}

export function isAgentScope(value: unknown): value is AgentScope {
  return agentScopes.some((scope) => scope === value);
}

/** Whether a scope reaches an action of this kind. */
export function scopeAllows(scope: AgentScope, kind: ActionKind): boolean {
  return kindsFor[scope].includes(kind);
}
