// How the audit log page words an event: when, who, what and the details.
// Plain functions, so a test checks each case without rendering the page.

export const changeKinds = ["insert", "update", "delete"] as const;
export type ChangeKind = (typeof changeKinds)[number];

/** How the page names what changed. Unknown names show as they are. */
const tableNames: Record<string, string> = {
  organization_settings: "Organization settings",
};
const fieldNames: Record<string, string> = {
  home_currency: "Home currency",
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

function shown(value: unknown): string {
  if (value === null || value === undefined) return "empty";
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** One line per field: a value, or for a change, old and new. */
export function changeLines(
  kind: ChangeKind,
  changes: Record<string, unknown>,
): string[] {
  return Object.entries(changes).map(([field, value]) => {
    const name = fieldNames[field] ?? field;
    if (kind === "update" && Array.isArray(value)) {
      return `${name}: ${shown(value[0])} to ${shown(value[1])}`;
    }
    return `${name}: ${shown(value)}`;
  });
}

export type Person = { readonly name: string; readonly email: string };

/**
 * Who acted: a member by name and address, BeeKeeping itself when no
 * person did (a migration or the demo seed), or someone who has left the
 * organization since, whose name the log never kept.
 */
export function actorText(
  actorUserId: string | null,
  members: ReadonlyMap<string, Person>,
): { readonly name: string; readonly email?: string } {
  if (actorUserId === null) return { name: "BeeKeeping itself" };
  const person = members.get(actorUserId);
  return person
    ? { name: person.name, email: person.email }
    : { name: "Someone no longer in this organization" };
}
