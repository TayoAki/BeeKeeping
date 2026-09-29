import { openDatabase, type DatabaseHandle } from "@beekeeping/db";

let handle: DatabaseHandle | undefined;

/**
 * The web app's connection pool, opened on first use. DATABASE_URL logs in as
 * the app's own login role, never as the database owner. Undefined when
 * DATABASE_URL isn't set, so pages can say so instead of crashing.
 */
export function database(): DatabaseHandle | undefined {
  const url = process.env.DATABASE_URL;
  if (!url) return undefined;
  handle ??= openDatabase(url);
  return handle;
}
