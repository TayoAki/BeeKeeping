import { inject } from "vitest";

import { adminQuery, databaseUrl, uniqueName } from "./admin.ts";

export type TestDatabase = {
  readonly url: string;
  readonly drop: () => Promise<void>;
};

async function create(from?: string): Promise<TestDatabase> {
  const serverUrl = inject("testDatabaseServerUrl");
  const name = uniqueName("bk_test");
  const template = from ? ` template "${from}"` : "";
  await adminQuery(serverUrl, `create database "${name}"${template}`);
  return {
    url: databaseUrl(serverUrl, name),
    drop: () =>
      adminQuery(serverUrl, `drop database if exists "${name}" with (force)`),
  };
}

/** A migrated database of its own for one test file. Drop it in afterAll. */
export function createTestDatabase(): Promise<TestDatabase> {
  return create(inject("testDatabaseTemplate"));
}

/** An empty database with no migrations, for testing the migrations. */
export function createEmptyDatabase(): Promise<TestDatabase> {
  return create();
}
