import { join } from "node:path";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

/** The SQL migrations drizzle-kit writes, applied in order. */
export const migrationsFolder = join(import.meta.dirname, "..", "drizzle");

/**
 * Applies every migration the database hasn't had yet. Running it again
 * changes nothing. The URL logs in as the database owner, because migrations
 * create tables and the app's role. Only migrations and test setup use the
 * owner.
 */
export async function migrateDatabase(url: string): Promise<void> {
  const client = new pg.Client({ connectionString: url });
  client.on("error", (error: Error & { code?: string }) => {
    // Only the code: the error carries the host and the user.
    console.error(
      `database: the migration connection failed (${error.code ?? "no code"})`,
    );
  });
  await client.connect();
  try {
    // An index build or a backfill may take minutes, so no statement limit.
    await client.query("set statement_timeout = 0");
    // Two deploys may migrate at once. The lock makes the second wait, then
    // find nothing left to apply. It ends with the connection.
    await client.query(
      "select pg_advisory_lock(hashtext('beekeeping:migrations'))",
    );
    await migrate(drizzle(client), { migrationsFolder });
  } finally {
    await client.end();
  }
}
