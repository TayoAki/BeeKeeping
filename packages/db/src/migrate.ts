import { join } from "node:path";

import { migrate } from "drizzle-orm/node-postgres/migrator";

import { openDatabase } from "./client.ts";

/** The SQL migrations drizzle-kit writes, applied in order. */
export const migrationsFolder = join(import.meta.dirname, "..", "drizzle");

/**
 * Applies every migration the database hasn't had yet. Running it again
 * changes nothing.
 */
export async function migrateDatabase(url: string): Promise<void> {
  // Migrations create tables and the app's role, so they run as the owner.
  const { db, close } = openDatabase(url, { as: "owner", max: 1 });
  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await close();
  }
}
