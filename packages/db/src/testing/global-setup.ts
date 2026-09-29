import type { TestProject } from "vitest/node";

import { startLocalPostgres } from "../../scripts/local-postgres.ts";
import { migrateDatabase } from "../migrate.ts";
import { adminQuery, databaseUrl, uniqueName } from "./admin.ts";

declare module "vitest" {
  export interface ProvidedContext {
    testDatabaseServerUrl: string;
    testDatabaseTemplate: string;
  }
}

/**
 * Migrates one template database per test run. Each test file then clones it,
 * so files never share rows. CI points TEST_DATABASE_ADMIN_URL at its
 * Postgres service; elsewhere the throwaway Postgres starts on demand.
 */
export default async function setup(project: TestProject) {
  const serverUrl = process.env.TEST_DATABASE_ADMIN_URL ?? startLocalPostgres();
  const template = uniqueName("bk_template");
  await adminQuery(serverUrl, `create database "${template}"`);
  await migrateDatabase(databaseUrl(serverUrl, template));

  project.provide("testDatabaseServerUrl", serverUrl);
  project.provide("testDatabaseTemplate", template);

  return async () => {
    await adminQuery(
      serverUrl,
      `drop database if exists "${template}" with (force)`,
    );
  };
}
