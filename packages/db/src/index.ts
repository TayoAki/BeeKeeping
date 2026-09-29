// The Drizzle schema, migrations, row-level security policies and seed data.
// Every table that holds an organization's data has org_id and a policy on it.
// The main entry opens app connections only. Migrations, which log in as the
// owner, live in @beekeeping/db/migrate.
export {
  openDatabase,
  type Database,
  type DatabaseHandle,
  type OpenOptions,
} from "./client.ts";
export { pingDatabase, type PingFailure } from "./health.ts";
export * as authSchema from "./schema/auth.ts";
