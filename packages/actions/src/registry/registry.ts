// The action registry: every action, and the one way to call one. A door to
// the actions, such as the web app's server action, calls invokeAction with
// a principal it built from its own sign-in, never from the request.
import type { Database } from "@beekeeping/db";
import { fail, type Fail, type Ok } from "@beekeeping/services";
import type { z } from "zod";

import { roleAtLeast } from "../access/roles.ts";
import { runAction, type Principal } from "../context.ts";
import {
  getOrganizationSettings,
  setUpOrganization,
} from "../organization/settings.ts";
import type { ActionDefinition, Message, SuccessOutput } from "./define.ts";

/** Every action. The doors offer these and nothing else. */
export const actions = [getOrganizationSettings, setUpOrganization] as const;

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
  | Fail<"unknown_action" | "forbidden", Message>
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
 * Runs one action for a principal, with the checks every door shares: the
 * principal's role, then the input schema, then the action in a
 * transaction of its own, then the output schema. A success keeps only the
 * fields its schema names, and a failure only its reason and message. An
 * answer that is neither, or a success its schema refuses, is a bug: it
 * throws, and the action's writes roll back.
 *
 * People call every action their role allows. Agents arrive in P0.11,
 * which adds scopes and the approval categories.
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
