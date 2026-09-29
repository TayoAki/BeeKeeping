import { inject } from "vitest";

import { adminQuery, databaseUrl, uniqueName } from "./admin.ts";
import "./provided.ts";

export type TestDatabase = {
  readonly url: string;
  readonly drop: () => Promise<void>;
};

function serverUrl(): string {
  const url = inject("testDatabaseServerUrl");
  if (!url) {
    throw new Error(
      "No test database server. Add @beekeeping/db/testing/global-setup to this package's Vitest globalSetup.",
    );
  }
  return url;
}

async function create(from?: string): Promise<TestDatabase> {
  const server = serverUrl();
  const name = uniqueName("bk_test");
  const template = from ? ` template "${from}"` : "";
  await adminQuery(server, `create database "${name}"${template}`);
  return {
    url: databaseUrl(server, name),
    drop: () =>
      adminQuery(server, `drop database if exists "${name}" with (force)`),
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
