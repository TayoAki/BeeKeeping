import { fail, ok, type Result } from "@beekeeping/services";
import type pg from "pg";

/**
 * Asks the database to answer a trivial query within timeoutMs. The failure
 * carries no error text, so a host name or user name never reaches a health
 * page, and a database that never answers can't hang the check.
 */
export async function pingDatabase(
  pool: pg.Pool,
  { timeoutMs = 3_000 }: { timeoutMs?: number } = {},
): Promise<Result<{ latencyMs: number }, "unreachable">> {
  const started = performance.now();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
  });
  try {
    const answer = await Promise.race([pool.query("select 1"), timeout]);
    if (answer === "timeout") return fail("unreachable");
    return ok({ latencyMs: Math.round(performance.now() - started) });
  } catch {
    return fail("unreachable");
  } finally {
    clearTimeout(timer);
  }
}
