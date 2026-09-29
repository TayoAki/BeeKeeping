import { pingDatabase, type DatabaseHandle } from "@beekeeping/db";

/**
 * Railway's health check. It answers 200 only when the database answers,
 * the app's login can't reach past row-level security, and it can reach
 * sign-in's tables. It never shows why a connection failed.
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
      "database: the app's login can do more than switch to beekeeping_app and beekeeping_auth. Point DATABASE_URL at the app's own login role, as AGENTS.md describes.",
    );
    return Response.json(
      { status: "unavailable", database: "misconfigured" },
      { status: 503 },
    );
  }
  if (ping.reason === "no_auth_role") {
    console.error(
      "database: the app's login can't switch to beekeeping_auth, so nobody can sign in. Grant it beekeeping_auth, as AGENTS.md describes.",
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
