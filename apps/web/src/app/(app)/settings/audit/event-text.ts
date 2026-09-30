// How the audit log page words an event: when, who, what and the details.
// Plain functions, so a test checks each case without rendering the page.

export const changeKinds = ["insert", "update", "delete"] as const;
export type ChangeKind = (typeof changeKinds)[number];

/** How the page names what changed. Unknown names show as they are. */
const tableNames: Record<string, string> = {
  agents: "Agents",
  api_tokens: "API tokens",
  organization_settings: "Organization settings",
};
const fieldNames: Record<string, string> = {
  agent_id: "Agent",
  expires_at: "Expires",
  home_currency: "Home currency",
  name: "Name",
  prefix: "Starts with",
  revoked_at: "Revoked",
  role: "Role",
  scope: "Scope",
};
export const kindNames: Record<ChangeKind, string> = {
  insert: "Created",
  update: "Changed",
  delete: "Deleted",
};

export function isChangeKind(value: string | undefined): value is ChangeKind {
  return changeKinds.some((kind) => kind === value);
}

export function tableName(table: string): string {
  return tableNames[table] ?? table;
}

/** A moment as 2026-09-29 23:05, in UTC. */
export function when(iso: string): string {
  return iso.slice(0, 16).replace("T", " ");
}

/**
 * A field's value as the page shows it: an agent by its name, a moment to
 * the minute in UTC, and anything else as it is.
 */
function shown(
  field: string,
  value: unknown,
  agents: ReadonlyMap<string, string>,
): string {
  if (value === null || value === undefined) return "empty";
  if (typeof value !== "string") return JSON.stringify(value);
  if (field === "agent_id") return agents.get(value) ?? value;
  // Postgres writes a moment with its offset, such as +00:00.
  const moment = field.endsWith("_at") ? new Date(value) : undefined;
  if (moment && !Number.isNaN(moment.getTime())) {
    return when(moment.toISOString());
  }
  return value;
}

/**
 * One line per field: a value, or for a change, old and new. agents names
 * the agents the log gives by id.
 */
export function changeLines(
  kind: ChangeKind,
  changes: Record<string, unknown>,
  agents: ReadonlyMap<string, string> = new Map(),
): string[] {
  return Object.entries(changes).map(([field, value]) => {
    const name = fieldNames[field] ?? field;
    if (kind === "update" && Array.isArray(value)) {
      return `${name}: ${shown(field, value[0], agents)} to ${shown(field, value[1], agents)}`;
    }
    return `${name}: ${shown(field, value, agents)}`;
  });
}

export type Person = { readonly name: string; readonly email: string };

/** Who an event names: a person, an agent, and whoever approved. */
export type Actors = {
  readonly actorUserId: string | null;
  readonly actorAgentId: string | null;
  readonly approvedByUserId: string | null;
};

const leftName = "Someone no longer in this organization";

/**
 * Who acted: a member by name and address, an agent by its name and who
 * approved, if anyone did, BeeKeeping itself when nobody acted (a
 * migration or the demo seed), or someone who has left the organization
 * since, whose name the log never kept.
 */
export function actorText(
  event: Actors,
  members: ReadonlyMap<string, Person>,
  agents: ReadonlyMap<string, string>,
): {
  readonly name: string;
  readonly email?: string;
  readonly detail?: string;
} {
  if (event.actorAgentId !== null) {
    return {
      name: agents.get(event.actorAgentId) ?? "An agent",
      detail:
        event.approvedByUserId === null
          ? "Agent"
          : `Agent, approved by ${members.get(event.approvedByUserId)?.name ?? leftName}`,
    };
  }
  if (event.actorUserId === null) return { name: "BeeKeeping itself" };
  const person = members.get(event.actorUserId);
  return person
    ? { name: person.name, email: person.email }
    : { name: leftName };
}
