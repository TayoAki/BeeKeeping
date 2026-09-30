// Applies every pending migration to MIGRATION_DATABASE_URL, which logs in as
// the database owner. Without it, this checkout's development database on the
// throwaway Postgres gets them: the script creates the database if needed and
// the app's local login, whose URL `pnpm -s db:url` prints.

import { parse } from "pg-connection-string";

import { migrateDatabase } from "../src/migrate.ts";
import {
  localDevelopmentDatabase,
  prepareLocalDatabase,
} from "./local-postgres.ts";

/** Where the migrations went, without the user name or password. */
function describe(url: string): string {
  try {
    const { host, port, database } = parse(url);
    // parse gives an empty string, not null, for a part the URL leaves out.
    // pg then reads PGHOST and PGPORT, or uses localhost and 5432.
    const server = `${host || process.env.PGHOST || "localhost"}:${port || process.env.PGPORT || "5432"}`;
    return `${server}/${database ?? ""}`;
  } catch {
    return "the configured database";
  }
}

const configured = process.env.MIGRATION_DATABASE_URL;
if (configured) {
  await migrateDatabase(configured);
  console.log(`Migrations applied to ${describe(configured)}.`);
} else {
  const url = await prepareLocalDatabase(localDevelopmentDatabase());
  console.log(
    `Migrations applied to ${describe(url)}. For the app, run: export DATABASE_URL="$(pnpm -s db:url)"`,
  );
}
