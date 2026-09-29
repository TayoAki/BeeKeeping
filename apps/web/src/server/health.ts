import { pingDatabase, type DatabaseHandle } from "@beekeeping/db";

/**
 * Railway's health check. It answers 200 only when the database answers and
 * the app's login can't reach past row-level security. It never shows why a
 * connection failed.
 */
export async function healthResponse(
  handle: DatabaseHandle | undefined,
): Promise<Response> {
  if (!handle) {
    return Response.json(
      { status: "unavailable", database: "not_configured" },
      { status: 503 },
    );
  }
  const ping = await pingDatabase(handle.pool);
  if (ping.ok) return Response.json({ status: "ok", database: "ok" });
  if (ping.reason === "unsafe_role") {
    console.error(
      "database: the app's login can do more than beekeeping_app. Point DATABASE_URL at the app's own login role, as AGENTS.md describes.",
    );
    return Response.json(
      { status: "unavailable", database: "misconfigured" },
      { status: 503 },
    );
  }
  return Response.json(
    { status: "unavailable", database: "unreachable" },
    { status: 503 },
  );
}
