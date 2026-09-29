// Applies every pending migration to DATABASE_URL. Without DATABASE_URL it
// uses this checkout's development database on the throwaway Postgres,
// creating both if needed. `pnpm db:url` prints that database's URL.

import pg from "pg";

import { migrateDatabase } from "../src/migrate.ts";
import {
  localDevelopmentDatabase,
  localDevelopmentUrl,
  startLocalPostgres,
} from "./local-postgres.ts";

async function ensureLocalDevelopmentDatabase(): Promise<string> {
  const serverUrl = await startLocalPostgres();
  const name = localDevelopmentDatabase();
  const client = new pg.Client({ connectionString: serverUrl });
  await client.connect();
  try {
    const found = await client.query(
      "select 1 from pg_database where datname = $1",
      [name],
    );
    if (found.rowCount === 0) await client.query(`create database "${name}"`);
  } finally {
    await client.end();
  }
  return localDevelopmentUrl();
}

/** Where the migrations went, without the user name or password. */
function describe(url: string): string {
  const { hostname, port, pathname } = new URL(url);
  return `${hostname}:${port || "5432"}${pathname}`;
}

const url =
  process.env.DATABASE_URL ?? (await ensureLocalDevelopmentDatabase());
await migrateDatabase(url);
console.log(`Migrations applied to ${describe(url)}.`);
