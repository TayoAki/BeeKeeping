import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";

import * as schema from "./schema/index.ts";

export type Database = NodePgDatabase<typeof schema>;

export type DatabaseHandle = {
  readonly db: Database;
  readonly pool: pg.Pool;
  readonly close: () => Promise<void>;
};

export type OpenOptions = {
  /**
   * "app" connections start as the beekeeping_app role, so row-level security
   * applies to every query. Only migrations and test setup use "owner".
   */
  readonly as?: "app" | "owner";
  readonly max?: number;
  /** How long to wait for a connection before giving up. */
  readonly connectionTimeoutMs?: number;
  /** How long one query may run before the client gives up on it. */
  readonly queryTimeoutMs?: number;
  /** Told about a broken idle connection. Logs its error code by default. */
  readonly onError?: (error: Error & { code?: string }) => void;
};

function logError(error: Error & { code?: string }): void {
  // The error object carries the host, the user and the connection details,
  // so only its code goes to the log.
  console.error(
    `database: an idle connection failed (${error.code ?? "no code"})`,
  );
}

/** Opens a connection pool to the database at url. */
export function openDatabase(
  url: string,
  {
    as = "app",
    max = 10,
    connectionTimeoutMs = 5_000,
    queryTimeoutMs = 30_000,
    onError = logError,
  }: OpenOptions = {},
): DatabaseHandle {
  const pool = new pg.Pool({
    connectionString: url,
    max,
    connectionTimeoutMillis: connectionTimeoutMs,
    query_timeout: queryTimeoutMs,
    // Postgres sets the role as the connection opens, before any query.
    ...(as === "app" ? { options: "-c role=beekeeping_app" } : {}),
  });
  // Without a listener, a dropped idle connection crashes the process.
  pool.on("error", onError);
  return { db: drizzle(pool, { schema }), pool, close: () => pool.end() };
}
