import { database } from "../../../server/database.ts";
import { healthResponse } from "../../../server/health.ts";

export const dynamic = "force-dynamic";

export function GET() {
  return healthResponse(database());
}
