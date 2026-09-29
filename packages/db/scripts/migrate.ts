// Applies every pending migration to MIGRATION_DATABASE_URL, which logs in as
// the database owner. Without it, this checkout's development database on the
// throwaway Postgres gets them: the script creates the database if needed and
// the app's local login, whose URL `pnpm -s db:url` prints.

import pg from "pg";

import { migrateDatabase } from "../src/migrate.ts";
import {
  localAdminUrl,
  localAppLogin,
  localDevelopmentDatabase,
  localDevelopmentOwnerUrl,
  startLocalPostgres,
} from "./local-postgres.ts";

async function asAdmin(work: (client: pg.Client) => Promise<void>) {
  const client = new pg.Client({ connectionString: localAdminUrl });
  await client.connect();
  try {
    await work(client);
  } finally {
    await client.end();
  }
}

async function ensureLocalDevelopmentDatabase(): Promise<string> {
  await startLocalPostgres();
  const name = localDevelopmentDatabase();
  await asAdmin(async (client) => {
    const found = await client.query(
      "select 1 from pg_database where datname = $1",
      [name],
    );
    if (found.rowCount === 0) await client.query(`create database "${name}"`);
  });
  return localDevelopmentOwnerUrl();
}

/**
 * The app's login on the throwaway server: it can log in and switch to
 * beekeeping_app, and nothing more. Roles belong to the whole server, and
 * another checkout may be making this one at the same moment.
 */
async function ensureLocalAppLogin(): Promise<void> {
  await asAdmin(async (client) => {
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${localAppLogin}') THEN
          BEGIN
            CREATE ROLE ${localAppLogin} LOGIN NOINHERIT;
          EXCEPTION
            WHEN duplicate_object OR unique_violation THEN NULL;
          END;
        END IF;
      END
      $$`);
    await client.query(`grant beekeeping_app to ${localAppLogin}`);
  });
}

/** Where the migrations went, without the user name or password. */
function describe(url: string): string {
  const { hostname, port, pathname } = new URL(url);
  return `${hostname}:${port || "5432"}${pathname}`;
}

const configured = process.env.MIGRATION_DATABASE_URL;
if (configured) {
  await migrateDatabase(configured);
  console.log(`Migrations applied to ${describe(configured)}.`);
} else {
  const url = await ensureLocalDevelopmentDatabase();
  await migrateDatabase(url);
  await ensureLocalAppLogin();
  console.log(
    `Migrations applied to ${describe(url)}. For the app, run: export DATABASE_URL="$(pnpm -s db:url)"`,
  );
}
