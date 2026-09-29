// Applies every pending migration to DATABASE_URL. Without DATABASE_URL it
// uses the beekeeping_dev database on the throwaway Postgres, creating both
// if needed.

import pg from "pg";

import { migrateDatabase } from "../src/migrate.ts";
import { databaseUrl } from "../src/testing/admin.ts";
import { startLocalPostgres } from "./local-postgres.ts";

async function localDevelopmentUrl(): Promise<string> {
  const serverUrl = startLocalPostgres();
  const client = new pg.Client({ connectionString: serverUrl });
  await client.connect();
  try {
    const found = await client.query(
      "select 1 from pg_database where datname = 'beekeeping_dev'",
    );
    if (found.rowCount === 0)
      await client.query("create database beekeeping_dev");
  } finally {
    await client.end();
  }
  return databaseUrl(serverUrl, "beekeeping_dev");
}

/** Where the migrations went, without the user name or password. */
function describe(url: string): string {
  const { hostname, port, pathname } = new URL(url);
  return `${hostname}:${port || "5432"}${pathname}`;
}

const url = process.env.DATABASE_URL ?? (await localDevelopmentUrl());
await migrateDatabase(url);
console.log(`Migrations applied to ${describe(url)}.`);
