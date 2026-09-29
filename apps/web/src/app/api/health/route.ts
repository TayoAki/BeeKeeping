import { database } from "../../../server/database.ts";
import { readServerEnv } from "../../../server/env.ts";
import { healthResponse } from "../../../server/health.ts";

export const dynamic = "force-dynamic";

export function GET() {
  // A deploy with missing settings fails the health check, instead of
  // failing the first person who signs in.
  try {
    readServerEnv(process.env);
  } catch (error) {
    // The message names each missing or wrong setting, never its value.
    console.error(
      `settings: ${error instanceof Error ? error.message : "the server's settings are incomplete."}`,
    );
    return Response.json(
      { status: "unavailable", settings: "incomplete" },
      { status: 503 },
    );
  }
  return healthResponse(database());
}
