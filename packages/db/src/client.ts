import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";

import * as schema from "./schema/index.ts";

export type Database = NodePgDatabase<typeof schema>;

export type DatabaseHandle = {
  readonly db: Database;
  readonly pool: pg.Pool;
  readonly close: () => Promise<void>;
};

/** Opens a connection pool to the database at url. */
export function openDatabase(
  url: string,
  { max = 10 }: { max?: number } = {},
): DatabaseHandle {
  const pool = new pg.Pool({ connectionString: url, max });
  return { db: drizzle(pool, { schema }), pool, close: () => pool.end() };
}
