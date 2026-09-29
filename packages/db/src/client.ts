import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { parse, toClientConfig } from "pg-connection-string";

import * as schema from "./schema/index.ts";

export type Database = NodePgDatabase<typeof schema>;

/** One transaction on a Database, as Database.transaction hands it over. */
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Who a pool's connections run as. "app" reads and writes organizations'
 * data under row-level security. "auth" is Better Auth's, and reaches only
 * sign-in's tables.
 */
export type ConnectionRole = "app" | "auth";

const roleNames: Record<ConnectionRole, string> = {
  app: "beekeeping_app",
  auth: "beekeeping_auth",
};

export type DatabaseHandle = {
  readonly db: Database;
  readonly pool: pg.Pool;
  readonly close: () => Promise<void>;
};

export type OpenOptions = {
  /** "app" unless the pool is Better Auth's. */
  readonly role?: ConnectionRole;
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
 * Reads the URL with pg's own parser, which keeps the URL, password
 * included, out of its errors. pg would let options in the URL replace the
 * ones passed beside it and drop the role, so the URL's options come first
 * and the role goes last, where Postgres lets it win.
 */
function withRole(url: string, role: ConnectionRole): pg.PoolConfig {
  const parsed = parse(url);
  // toClientConfig drops an ssl value it reads as text, and pg would then
  // connect without TLS. pg reads ssl=no-verify as TLS that doesn't check
  // the certificate, so that stays, and any other text is refused.
  if (parsed.ssl === "no-verify") parsed.ssl = { rejectUnauthorized: false };
  if (typeof parsed.ssl === "string") {
    throw new Error(
      "The database URL's ssl setting isn't one BeeKeeping reads. Use sslmode, such as sslmode=verify-full.",
    );
  }
  const config = toClientConfig(parsed);
  return {
    ...config,
    options: [config.options, `-c role=${roleNames[role]}`]
      .filter(Boolean)
      .join(" "),
  };
}

/**
 * Opens a connection pool. Each connection starts as beekeeping_app, or as
 * beekeeping_auth for Better Auth, before any query, so row-level security
 * applies to everything it sends. The URL logs in as the app's own login
 * role, which has no rights beyond those two roles. It never logs in as the
 * database owner.
 */
export function openDatabase(
  url: string,
  {
    role = "app",
    max = 10,
    connectionTimeoutMs = 5_000,
    statementTimeoutMs = 30_000,
    onError = logError,
  }: OpenOptions = {},
): DatabaseHandle {
  const pool = new pg.Pool({
    ...withRole(url, role),
    max,
    connectionTimeoutMillis: connectionTimeoutMs,
    statement_timeout: statementTimeoutMs,
  });
  // Without a listener, a dropped idle connection crashes the process.
  pool.on("error", onError);
  return { db: drizzle(pool, { schema }), pool, close: () => pool.end() };
}
