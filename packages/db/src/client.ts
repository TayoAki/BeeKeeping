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
  readonly max?: number;
  /** How long to wait for a connection before giving up. */
  readonly connectionTimeoutMs?: number;
  /**
   * Postgres cancels a statement that runs longer than this. 0 leaves the
   * server's own limit. The server does the cancelling, so a slow statement
   * never sends its connection back to the pool in the middle of a
   * transaction.
   */
  readonly statementTimeoutMs?: number;
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

/**
 * pg lets options in the URL replace the ones passed beside it, which would
 * drop the role. So the URL's options come first and the role goes last,
 * where Postgres lets it win.
 */
function withAppRole(url: string) {
  const parsed = new URL(url);
  const fromUrl = parsed.searchParams.get("options");
  parsed.searchParams.delete("options");
  return {
    connectionString: parsed.toString(),
    options: [fromUrl, "-c role=beekeeping_app"].filter(Boolean).join(" "),
  };
}

/**
 * Opens the app's connection pool. Each connection starts as beekeeping_app,
 * before any query, so row-level security applies to everything the app
 * sends. The URL logs in as the app's own login role, which has no rights
 * beyond beekeeping_app. It never logs in as the database owner.
 */
export function openDatabase(
  url: string,
  {
    max = 10,
    connectionTimeoutMs = 5_000,
    statementTimeoutMs = 30_000,
    onError = logError,
  }: OpenOptions = {},
): DatabaseHandle {
  const pool = new pg.Pool({
    ...withAppRole(url),
    max,
    connectionTimeoutMillis: connectionTimeoutMs,
    statement_timeout: statementTimeoutMs,
  });
  // Without a listener, a dropped idle connection crashes the process.
  pool.on("error", onError);
  return { db: drizzle(pool, { schema }), pool, close: () => pool.end() };
}
