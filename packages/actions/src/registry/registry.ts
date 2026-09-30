// The action registry: every action, and the one way to call one. A door to
// the actions, such as the web app's server action, calls invokeAction with
// a principal it built from its own sign-in, never from the request.
import type { Database } from "@beekeeping/db";
import { fail, type Fail, type Ok } from "@beekeeping/services";
import { sql } from "drizzle-orm";
import type { z } from "zod";

import { scopeAllows } from "../access/agents.ts";
import { roleAtLeast } from "../access/roles.ts";
import {
  createAgent,
  createApiToken,
  listAgents,
  revokeAgent,
  revokeApiToken,
} from "../agents/agents.ts";
import { listAuditEvents } from "../audit/events.ts";
import {
  runAction,
  type ActionContext,
  type AgentPrincipal,
  type Principal,
} from "../context.ts";
import {
  getOrganizationSettings,
  setUpOrganization,
} from "../organization/settings.ts";
import type { ActionDefinition, Message, SuccessOutput } from "./define.ts";

/** Every action. The doors offer these and nothing else. */
export const actions = [
  createAgent,
  createApiToken,
  getOrganizationSettings,
  listAgents,
  listAuditEvents,
  revokeAgent,
  revokeApiToken,
  setUpOrganization,
] as const;

type Registered = (typeof actions)[number];
export type ActionName = Registered["name"];
type Named<Name extends ActionName> = Extract<
  Registered,
  { readonly name: Name }
>;

/** What an action takes, before its input schema parses it. */
export type ActionInput<Name extends ActionName> = z.input<
  Named<Name>["input"]
>;

/** A field the input schema refused, and why, without its value. */
export type InputIssue = { readonly path: string; readonly message: string };

/** How invokeAction refuses before an action runs. */
export type InvokeFailure =
  | Fail<"unknown_action" | "forbidden" | "approval_required", Message>
  | Fail<"invalid_input", Message & { readonly issues: InputIssue[] }>;

/** What calling an action by name comes back with. */
export type ActionOutcome<Name extends ActionName> =
  | Ok<SuccessOutput<Named<Name>["output"]>>
  | Extract<Awaited<ReturnType<Named<Name>["run"]>>, { readonly ok: false }>
  | InvokeFailure;

const byName = new Map<string, ActionDefinition>(
  actions.map((action) => [action.name, action]),
);

/** The registered action with this name, if there is one. */
export function findAction(name: unknown): ActionDefinition | undefined {
  return typeof name === "string" ? byName.get(name) : undefined;
}

/** How many of the input's problems an answer carries at most. */
const issueLimit = 20;

/**
 * Why an agent may not call this action at all, or undefined when it may.
 * Agents never call an action marked never, which every admin action is,
 * and call only the kinds their scope reaches.
 */
function agentRefusal(
  agent: AgentPrincipal,
  action: ActionDefinition,
): InvokeFailure | undefined {
  if (action.approval === "never") {
    return fail("forbidden", {
      message: "Agents can't do that. A person in the organization can.",
    });
  }
  if (!scopeAllows(agent.scope, action.kind)) {
    return fail("forbidden", {
      message: "This agent's scope doesn't allow that.",
    });
  }
  return undefined;
}

/**
 * Whether the database backs the agent a call acts for: the agent works,
 * with the role and scope its principal claims. A principal built before
 * the agent was revoked, or one made up, gets no further.
 */
async function agentWorks(
  ctx: ActionContext,
  agent: AgentPrincipal,
): Promise<boolean> {
  const found = await ctx.tx.execute<{ role: string; scope: string }>(
    sql`select role, scope from working_agent()`,
  );
  const [row] = found.rows;
  return row?.role === agent.role && row.scope === agent.scope;
}

/**
 * Runs one action for a principal, with the checks every door shares: the
 * principal's role, then for an agent its scope, then the input schema,
 * then the action in a transaction of its own, where an agent must still
 * work and have the approval the action needs, then the output schema. A success keeps only the fields its schema names, and a failure
 * only its reason and message. An answer that is neither, or a success its
 * schema refuses, is a bug: it throws, and the action's writes roll back.
 */
export async function invokeDefinition(
  db: Database,
  principal: Principal,
  action: ActionDefinition,
  input: unknown,
): Promise<
  Ok<Record<string, unknown>> | Fail<string, Message> | InvokeFailure
> {
  if (!roleAtLeast(principal.role, action.role)) {
    return fail("forbidden", {
      message: "Your role in this organization doesn't allow that.",
    });
  }
  const agent = principal.kind === "agent" ? principal : undefined;
  if (agent) {
    const refusal = agentRefusal(agent, action);
    if (refusal) return refusal;
  }
  const parsed = action.input.safeParse(input);
  if (!parsed.success) {
    // zod reports each bad item of a list, so a long list could fill the
    // answer many times over.
    return fail("invalid_input", {
      message: "Some of what was sent isn't right.",
      issues: parsed.error.issues.slice(0, issueLimit).map((issue) => ({
        path: issue.path.map(String).join("."),
        message: issue.message,
      })),
    });
  }
  return runAction(db, principal, async (ctx) => {
    if (agent && !(await agentWorks(ctx, agent))) {
      return fail("forbidden", {
        message: "This agent has been revoked, or isn't this organization's.",
      });
    }
    // A post that a person approves, by policy or each time, waits for
    // one, once the input is right and the agent works. P1.12 adds the
    // queue and the policies. Until then an agent's post runs only when
    // its principal names the person who approved it.
    if (agent && action.approval !== "none" && !agent.approvedBy) {
      return fail("approval_required", {
        message: "A person in the organization needs to approve this first.",
      });
    }
    const answer = ((await action.run(ctx, parsed.data)) ?? {}) as Record<
      string,
      unknown
    >;
    if (answer.ok === false) {
      const { reason, message } = answer;
      if (typeof reason !== "string" || typeof message !== "string") {
        throw new Error(
          `The action ${action.name} returned a failure without a reason and a message.`,
        );
      }
      return fail(reason, { message });
    }
    if (answer.ok !== true) {
      throw new Error(`The action ${action.name} returned no result.`);
    }
    const { ok: _ok, ...fields } = answer;
    const checked = action.output.safeParse(fields);
    if (!checked.success) {
      throw new Error(
        `The action ${action.name} returned a success that its output schema refuses.`,
      );
    }
    return { ...checked.data, ok: true as const };
  });
}

/** Runs the registered action with this name. See invokeDefinition. */
export async function invokeAction<Name extends ActionName>(
  db: Database,
  principal: Principal,
  name: Name,
  input: unknown,
): Promise<ActionOutcome<Name>> {
  const action = findAction(name);
  if (!action) {
    return fail("unknown_action", { message: "There's no such action." });
  }
  // The registry's types say what this action's outcome holds.
  return (await invokeDefinition(
    db,
    principal,
    action,
    input,
  )) as ActionOutcome<Name>;
}
