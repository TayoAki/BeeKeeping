import { inject } from "vitest";

import { adminQuery, databaseUrl, uniqueName, withLogin } from "./admin.ts";
import "./provided.ts";

export type TestDatabase = {
  /** Logs in as the owner, for setting up rows and checking what happened. */
  readonly url: string;
  /** Logs in the way the app does, for openDatabase. */
  readonly appUrl: string;
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
  const { user, password } = inject("testDatabaseAppLogin");
  const name = uniqueName("bk_test");
  const template = from ? ` template "${from}"` : "";
  await adminQuery(server, `create database "${name}"${template}`);
  const url = databaseUrl(server, name);
  return {
    url,
    appUrl: withLogin(url, user, password),
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

/**
 * What Postgres said when work failed. Drizzle wraps it in an error whose
 * message is the failed SQL, so the message alone proves nothing.
 */
export async function postgresError(
  work: Promise<unknown>,
): Promise<{ message: string; code?: string }> {
  try {
    await work;
  } catch (error) {
    return ((error as { cause?: unknown }).cause ?? error) as {
      message: string;
      code?: string;
    };
  }
  throw new Error("It didn't fail.");
}
