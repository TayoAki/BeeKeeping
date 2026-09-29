import { randomBytes } from "node:crypto";

import { startLocalPostgres } from "../../scripts/local-postgres.ts";
import { migrateDatabase } from "../migrate.ts";
import { adminQuery, databaseUrl, uniqueName, withLogin } from "./admin.ts";

export type AppDatabase = {
  /** Logs in as the database owner, for setting up rows. */
  readonly ownerUrl: string;
  /** Logs in the way the app does, for DATABASE_URL. */
  readonly appUrl: string;
  /** Drops the database and its login. */
  drop(): Promise<void>;
};

/**
 * A fresh, migrated database with a login of its own that works the way the
 * app's does, for running the app itself in the end-to-end tests.
 * TEST_DATABASE_ADMIN_URL picks the server, as it does for the unit tests;
 * otherwise the throwaway Postgres starts.
 */
export async function createAppDatabase(): Promise<AppDatabase> {
  const serverUrl =
    process.env.TEST_DATABASE_ADMIN_URL || (await startLocalPostgres());
  const name = uniqueName("bk_e2e");
  const login = {
    user: uniqueName("bk_e2e_web"),
    password: randomBytes(16).toString("hex"),
  };
  const drop = async () => {
    await adminQuery(
      serverUrl,
      `drop database if exists "${name}" with (force)`,
    );
    await adminQuery(serverUrl, `drop role if exists "${login.user}"`);
  };
  await adminQuery(serverUrl, `create database "${name}"`);
  try {
    const ownerUrl = databaseUrl(serverUrl, name);
    await migrateDatabase(ownerUrl);
    await adminQuery(
      serverUrl,
      `create role "${login.user}" login noinherit password '${login.password}'`,
    );
    await adminQuery(
      serverUrl,
      `grant beekeeping_app, beekeeping_auth to "${login.user}"`,
    );
    return {
      ownerUrl,
      appUrl: withLogin(ownerUrl, login.user, login.password),
      drop,
    };
  } catch (error) {
    await drop();
    throw error;
  }
}
