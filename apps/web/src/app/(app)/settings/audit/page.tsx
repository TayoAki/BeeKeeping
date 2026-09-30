import type { Metadata } from "next";
import { roleAtLeast } from "@beekeeping/actions";
import { TableScroll } from "@beekeeping/ui";
import { headers } from "next/headers";
import { forbidden, redirect } from "next/navigation";

import { invokeForMember } from "../../../../server/actions.ts";
import { getAuth } from "../../../../server/auth.ts";
import {
  activeMembership,
  requireSignedIn,
} from "../../../../server/session.ts";
import {
  actorText,
  changeKinds,
  changeLines,
  isChangeKind,
  kindNames,
  tableName,
  when,
  type Person,
} from "./event-text.ts";

// Below admin the page answers 403, and its title says so too, since the
// 403 page can't set one.
export async function generateMetadata(): Promise<Metadata> {
  const membership = await activeMembership();
  const refused = membership && !roleAtLeast(membership.role, "admin");
  return { title: refused ? "Not allowed" : "Audit log" };
}

type Search = Record<string, string | string[] | undefined>;

type Outcome = Awaited<ReturnType<typeof invokeForMember<"list_audit_events">>>;

function text(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** Who acted, with the member's address below their name. */
function Actor({
  actorUserId,
  members,
}: {
  actorUserId: string | null;
  members: ReadonlyMap<string, Person>;
}) {
  const actor = actorText(actorUserId, members);
  if (actor.email === undefined) return <>{actor.name}</>;
  return (
    <>
      {actor.name}
      <br />
      <span className="hint address">{actor.email}</span>
    </>
  );
}

/** The events, or why there are none. */
function Results({
  outcome,
  filtered,
  members,
}: {
  outcome: Outcome;
  filtered: boolean;
  members: ReadonlyMap<string, Person>;
}) {
  if (!outcome.ok) {
    return (
      <p role="alert" className="error">
        {outcome.reason === "invalid_input"
          ? "One of those filters doesn't work. Choose them again."
          : outcome.message}
      </p>
    );
  }
  if (outcome.events.length === 0) {
    return (
      <p>
        {filtered
          ? "No events match these filters."
          : "Nothing in the audit log yet."}
      </p>
    );
  }
  return (
    <TableScroll label="Audit events">
      <table>
        <caption className="hint">
          {outcome.events.length === 1
            ? "The newest event."
            : `The newest ${outcome.events.length} events.`}
        </caption>
        <thead>
          <tr>
            <th scope="col">When</th>
            <th scope="col">Who</th>
            <th scope="col">What</th>
            <th scope="col">Details</th>
          </tr>
        </thead>
        <tbody>
          {outcome.events.map((event) => (
            <tr key={event.id}>
              <td className="nowrap">
                <time dateTime={event.occurredAt}>
                  {when(event.occurredAt)}
                </time>
              </td>
              <td>
                <Actor actorUserId={event.actorUserId} members={members} />
              </td>
              <td>
                {tableName(event.tableName)},{" "}
                {kindNames[event.action].toLowerCase()}
              </td>
              <td>
                <ul className="plain">
                  {changeLines(event.action, event.changes).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroll>
  );
}

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  await requireSignedIn();
  const membership = await activeMembership();
  if (!membership) redirect("/");
  if (!roleAtLeast(membership.role, "admin")) forbidden();

  const query = await searchParams;
  const kind = text(query.action);
  const filters = {
    table: text(query.table),
    action: isChangeKind(kind) ? kind : undefined,
    from: text(query.from),
    to: text(query.to),
  };
  const [outcome, organization] = await Promise.all([
    invokeForMember("list_audit_events", filters),
    // The same organization the events come from, even if the person
    // switches in another tab meanwhile.
    getAuth()
      .api.getFullOrganization({
        headers: await headers(),
        query: { organizationId: membership.organizationId },
      })
      .catch(() => {
        // As in session.ts: the error carries the query and its parameters.
        throw new Error("We couldn't read the organization's members.");
      }),
  ]);
  // The log keeps a person's id. Members show by name; anyone else left.
  const members = new Map(
    (organization?.members ?? []).map((member) => [member.userId, member.user]),
  );
  const filtered = Object.values(filters).some(Boolean);
  // A table the list doesn't have, from an edited address or a refused
  // filter, stays chosen rather than turning into "All tables".
  const tables = outcome.ok ? outcome.tables : [];
  const tableChoices =
    filters.table && !tables.includes(filters.table)
      ? [...tables, filters.table]
      : tables;

  return (
    <>
      <h1>Audit log</h1>
      <p>
        Who changed what in this organization&apos;s books, newest first. Nobody
        can change the log. Times are in UTC.
      </p>
      <form method="get" aria-labelledby="audit-filters">
        <h2 id="audit-filters">Show</h2>
        <div className="field-grid">
          <div>
            <label htmlFor="audit-table">Table</label>
            <select id="audit-table" name="table" defaultValue={filters.table}>
              <option value="">All tables</option>
              {tableChoices.map((table) => (
                <option key={table} value={table}>
                  {tableName(table)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="audit-kind">Change</label>
            <select id="audit-kind" name="action" defaultValue={filters.action}>
              <option value="">Every change</option>
              {changeKinds.map((change) => (
                <option key={change} value={change}>
                  {kindNames[change]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="audit-from">From</label>
            <input
              id="audit-from"
              name="from"
              type="date"
              defaultValue={filters.from}
            />
          </div>
          <div>
            <label htmlFor="audit-to">To</label>
            <input
              id="audit-to"
              name="to"
              type="date"
              defaultValue={filters.to}
            />
          </div>
        </div>
        <button type="submit" className="secondary">
          Show events
        </button>
      </form>
      <Results outcome={outcome} filtered={filtered} members={members} />
    </>
  );
}
