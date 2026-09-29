import { fail, ok, type Result } from "@beekeeping/services";
import type pg from "pg";

/**
 * Asks the database to answer a trivial query. The failure carries no error
 * text, so a host name or user name never reaches a health page.
 */
export async function pingDatabase(
  pool: pg.Pool,
): Promise<Result<{ latencyMs: number }, "unreachable">> {
  const started = performance.now();
  try {
    await pool.query("select 1");
    return ok({ latencyMs: Math.round(performance.now() - started) });
  } catch {
    return fail("unreachable");
  }
}
