import { randomBytes } from "node:crypto";

import type { TestProject } from "vitest/node";

import { startLocalPostgres } from "../../scripts/local-postgres.ts";
import { migrateDatabase } from "../migrate.ts";
import { adminQuery, databaseUrl, uniqueName } from "./admin.ts";
import "./provided.ts";

/**
 * Migrates one template database per test project. Each test file then clones
 * it, so files never share rows. A package whose tests need a database lists
 * this file, @beekeeping/db/testing/global-setup, in its Vitest globalSetup.
 * CI points TEST_DATABASE_ADMIN_URL at its Postgres service; elsewhere the
 * throwaway Postgres starts on demand.
 *
 * The run also gets a login role of its own that works the way the app's
 * does: it can log in and switch to beekeeping_app or beekeeping_auth, and
 * it has no rights of its own.
 */
export default async function setup(project: TestProject) {
  const serverUrl =
    process.env.TEST_DATABASE_ADMIN_URL || (await startLocalPostgres());
  const template = uniqueName("bk_template");
  const appLogin = {
    user: uniqueName("bk_web"),
    password: randomBytes(16).toString("hex"),
  };
  const cleanUp = async () => {
    await adminQuery(
      serverUrl,
      `drop database if exists "${template}" with (force)`,
    );
    await adminQuery(serverUrl, `drop role if exists "${appLogin.user}"`);
  };

  await adminQuery(serverUrl, `create database "${template}"`);
  try {
    await migrateDatabase(databaseUrl(serverUrl, template));
    await adminQuery(
      serverUrl,
      `create role "${appLogin.user}" login noinherit password '${appLogin.password}'`,
    );
    await adminQuery(
      serverUrl,
      `grant beekeeping_app, beekeeping_auth to "${appLogin.user}"`,
    );
  } catch (error) {
    await cleanUp();
    throw error;
  }

  project.provide("testDatabaseServerUrl", serverUrl);
  project.provide("testDatabaseTemplate", template);
  project.provide("testDatabaseAppLogin", appLogin);
  return cleanUp;
}
