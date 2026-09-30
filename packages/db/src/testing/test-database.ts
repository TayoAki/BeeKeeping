import pg from "pg";
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

/**
 * Runs call while another transaction, logged in as url's owner, holds the
 * rows the statements change, and commits them once call waits for one of
 * those rows. Answers what call answers. It throws when call never waits,
 * since then the two never overlapped.
 */
export async function racing<T>(
  url: string,
  statements: readonly (readonly [string, unknown[]])[],
  call: () => Promise<T>,
): Promise<T> {
  const other = new pg.Client({ connectionString: url });
  await other.connect();
  try {
    await other.query("begin");
    for (const [text, values] of statements) await other.query(text, values);
    let settled = false;
    const answer = call().finally(() => {
      settled = true;
    });
    // Caught here and awaited below, so a failure isn't unhandled meanwhile.
    answer.catch(() => undefined);
    for (let tries = 0; ; tries += 1) {
      // Postgres keeps the sessions it listed first for the rest of a
      // transaction, so each look starts afresh. Only the sessions this
      // transaction holds up count.
      await other.query("select pg_stat_clear_snapshot()");
      const { rows } = await other.query<{ waiting: number }>(
        `select count(*)::int as waiting from pg_stat_activity
          where pg_backend_pid() = any(pg_blocking_pids(pid))`,
      );
      if ((rows[0]?.waiting ?? 0) > 0) break;
      if (settled || tries === 200) {
        await other.query("rollback");
        throw new Error("The call never waited for the other transaction.");
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    await other.query("commit");
    return await answer;
  } finally {
    await other.end();
  }
}
