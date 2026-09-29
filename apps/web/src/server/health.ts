import { pingDatabase, type DatabaseHandle } from "@beekeeping/db";

/**
 * Railway's health check. It answers 200 only when the database answers, and
 * it never shows why a check failed.
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
  return ping.ok
    ? Response.json({ status: "ok", database: "ok" })
    : Response.json(
        { status: "unavailable", database: "unreachable" },
        { status: 503 },
      );
}
