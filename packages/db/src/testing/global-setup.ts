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
 */
export default async function setup(project: TestProject) {
  const serverUrl =
    process.env.TEST_DATABASE_ADMIN_URL ?? (await startLocalPostgres());
  const template = uniqueName("bk_template");
  const drop = () =>
    adminQuery(serverUrl, `drop database if exists "${template}" with (force)`);

  await adminQuery(serverUrl, `create database "${template}"`);
  try {
    await migrateDatabase(databaseUrl(serverUrl, template));
  } catch (error) {
    await drop();
    throw error;
  }

  project.provide("testDatabaseServerUrl", serverUrl);
  project.provide("testDatabaseTemplate", template);
  return drop;
}
