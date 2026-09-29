import { fail, ok, type Result } from "@beekeeping/services";
import type pg from "pg";

export type PingFailure = "unreachable" | "unsafe_role";

// True when the connection runs as beekeeping_app and its login can do no
// more: it isn't a superuser, can't skip row-level security, doesn't own
// the database, and can switch to beekeeping_app and to no other role.
const roleCheck = `
  select current_user = 'beekeeping_app'
         and not login.rolsuper
         and not login.rolbypassrls
         and login.oid <> db.datdba
         and not exists (
           select from pg_roles other
            where other.oid <> login.oid
              and other.rolname <> 'beekeeping_app'
              and pg_has_role(login.oid, other.oid, 'member')) as safe
    from pg_roles login, pg_database db
   where login.rolname = session_user and db.datname = current_database()`;

/**
 * Asks the database to answer within timeoutMs, and checks that the app's
 * login can't reach past row-level security. The failure carries no error
 * text, so a host name or user name never reaches a health page, and a
 * database that never answers can't hang the check.
 */
export async function pingDatabase(
  pool: pg.Pool,
  { timeoutMs = 3_000 }: { timeoutMs?: number } = {},
): Promise<Result<{ latencyMs: number }, PingFailure>> {
  const started = performance.now();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
  });
  try {
    const answer = await Promise.race([
      pool.query<{ safe: boolean }>(roleCheck),
      timeout,
    ]);
    if (answer === "timeout") return fail("unreachable");
    if (answer.rows[0]?.safe !== true) return fail("unsafe_role");
    return ok({ latencyMs: Math.round(performance.now() - started) });
  } catch {
    return fail("unreachable");
  } finally {
    clearTimeout(timer);
  }
}
