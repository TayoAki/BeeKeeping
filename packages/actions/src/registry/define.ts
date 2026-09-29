// What every action declares, so that each door to the actions (the web
// app now, the MCP server and the REST API later) offers the same actions
// with the same checks. See "How it fits the architecture" in
// docs/agent-back-office.md.
import type { Result } from "@beekeeping/services";
import { z } from "zod";

import { isRole, roleNames, type Role } from "../access/roles.ts";
import type { ActionContext } from "../context.ts";

/**
 * What an action does to the business. A read only looks. A draft
 * prepares or records something inside the company, such as an unposted
 * invoice or a new customer: it posts nothing to the books, moves no money
 * and reaches no one outside. A post changes the books or reaches someone
 * outside, such as sending an invoice or moving money, so a person may need
 * to approve it. An admin action changes who may do what, or how the
 * organization is set up. A read that agents must never get, such as one
 * that shows a whole bank account number or lists API tokens, is an admin
 * action too, since a read can't take never.
 */
export const actionKinds = ["read", "draft", "post", "admin"] as const;
export type ActionKind = (typeof actionKinds)[number];

/**
 * Whether an agent's call waits for a person: none, the organization's
 * policy decides, a person approves each call, or agents never call it.
 */
export const approvalCategories = ["none", "policy", "ask", "never"] as const;
export type ApprovalCategory = (typeof approvalCategories)[number];

/**
 * The categories each kind may have. Reads and drafts post nothing, move
 * no money and reach no one outside, so they wait for nobody. Agents never
 * administer.
 */
export const approvalsFor: Readonly<
  Record<ActionKind, readonly ApprovalCategory[]>
> = {
  read: ["none"],
  draft: ["none"],
  post: ["policy", "ask", "never"],
  admin: ["never"],
};

/** What a failure carries besides its reason: a message for the person. */
export type Message = { readonly message: string };

export type ActionDefinition<
  Name extends string = string,
  Input extends z.ZodObject = z.ZodObject,
  Output extends z.ZodObject = z.ZodObject,
  Reason extends string = string,
> = {
  /** In snake_case, as agents and the REST API will call it. */
  readonly name: Name;
  /** A sentence or two for the person or agent choosing an action. */
  readonly description: string;
  readonly kind: ActionKind;
  /** The lowest role that may call it. */
  readonly role: Role;
  readonly approval: ApprovalCategory;
  readonly input: Input;
  /** A success's fields. Fields the schema doesn't name are dropped. */
  readonly output: Output;
  // A method, so a list can hold actions whose inputs differ.
  run(
    ctx: ActionContext,
    input: z.output<Input>,
  ): Promise<Result<SuccessFields<Output>, Reason, Message>>;
};

/** A success's fields as run returns them, or none when there are none. */
type SuccessFields<Output extends z.ZodObject> = [
  keyof Output["shape"],
] extends [never]
  ? Record<never, never>
  : z.input<Output>;

/** A success's fields as a caller gets them, or none when there are none. */
export type SuccessOutput<Output extends z.ZodObject> = [
  keyof Output["shape"],
] extends [never]
  ? Record<never, never>
  : z.output<Output>;

const namePattern = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;
const nameLimit = 64;

function isKind(value: unknown): value is ActionKind {
  return actionKinds.some((kind) => kind === value);
}

function isApproval(value: unknown): value is ApprovalCategory {
  return approvalCategories.some((category) => category === value);
}

/**
 * Whether an object schema, or one anywhere inside it, keeps fields it
 * doesn't name: a loose, strict or catchall object. A record's keys, or
 * unknown, let anything through by design, as a list of changed fields
 * does. A schema met again, as in a recursive one, is checked once.
 */
function keepsUnnamedFields(
  schema: unknown,
  seen = new Set<unknown>(),
): boolean {
  if (!(schema instanceof z.ZodType) || seen.has(schema)) return false;
  seen.add(schema);
  const inside = (part: unknown) => keepsUnnamedFields(part, seen);
  if (schema instanceof z.ZodObject) {
    return (
      schema._zod.def.catchall !== undefined ||
      Object.values(schema.shape).some(inside)
    );
  }
  // Wrappers, lists, records, unions, intersections, pipes and tuples keep
  // their parts in these fields of their definition.
  const def = schema._zod.def as unknown as Record<string, unknown>;
  const parts = [
    def.innerType,
    def.element,
    def.valueType,
    def.left,
    def.right,
    def.in,
    def.out,
    def.rest,
    ...(Array.isArray(def.options) ? (def.options as unknown[]) : []),
    ...(Array.isArray(def.items) ? (def.items as unknown[]) : []),
    schema instanceof z.ZodLazy ? schema.unwrap() : undefined,
  ];
  return parts.some(inside);
}

/**
 * Everything wrong with a definition, one problem per field, in plain
 * words. An empty list means the definition is complete.
 */
export function definitionProblems(definition: unknown): string[] {
  const fields = (
    typeof definition === "object" && definition !== null ? definition : {}
  ) as Record<string, unknown>;
  const problems: string[] = [];
  const { name, description, kind, role, approval, input, output, run } =
    fields;

  if (name === undefined) problems.push("name is missing");
  else if (
    typeof name !== "string" ||
    !namePattern.test(name) ||
    name.length > nameLimit
  ) {
    problems.push(
      `name must be snake_case, up to ${nameLimit} characters, such as get_organization_settings`,
    );
  }
  if (description === undefined) problems.push("description is missing");
  else if (typeof description !== "string" || description.trim() === "") {
    problems.push("description must say what the action does");
  }
  if (kind === undefined) problems.push("kind is missing");
  else if (!isKind(kind)) {
    problems.push(`kind must be one of ${actionKinds.join(", ")}`);
  }
  if (role === undefined) problems.push("role is missing");
  else if (typeof role !== "string" || !isRole(role)) {
    problems.push(`role must be one of ${roleNames.join(", ")}`);
  }
  if (approval === undefined) problems.push("approval is missing");
  else if (!isApproval(approval)) {
    problems.push(`approval must be one of ${approvalCategories.join(", ")}`);
  } else if (isKind(kind) && !approvalsFor[kind].includes(approval)) {
    problems.push(
      `approval for a ${kind} action must be ${approvalsFor[kind].join(" or ")}`,
    );
  }
  if (input === undefined) problems.push("input is missing");
  else if (!(input instanceof z.ZodObject)) {
    problems.push("input must be a zod object schema");
  }
  if (output === undefined) problems.push("output is missing");
  else if (!(output instanceof z.ZodObject)) {
    problems.push("output must be a zod object schema");
  } else if (keepsUnnamedFields(output)) {
    problems.push(
      "output must drop the fields it doesn't name: use z.object, not a loose, strict or catchall object",
    );
  } else if ("ok" in output.shape || "reason" in output.shape) {
    problems.push("output can't name ok or reason, which every result has");
  }
  if (run === undefined) problems.push("run is missing");
  else if (typeof run !== "function") problems.push("run must be a function");
  return problems;
}

/**
 * Declares one action. A definition that leaves out a field, or gets one
 * wrong, throws when its module loads, so the app never starts with it.
 */
export function defineAction<
  Name extends string,
  Input extends z.ZodObject,
  Output extends z.ZodObject,
  Reason extends string,
>(
  definition: ActionDefinition<Name, Input, Output, Reason>,
): ActionDefinition<Name, Input, Output, Reason> {
  const problems = definitionProblems(definition);
  if (problems.length > 0) {
    throw new Error(
      `The action ${String(definition.name)} is incomplete: ${problems.join("; ")}.`,
    );
  }
  return Object.freeze(definition);
}
