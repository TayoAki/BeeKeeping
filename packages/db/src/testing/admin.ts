import { randomBytes } from "node:crypto";

import pg from "pg";

/** A database name no other test run will pick, such as bk_test_3f9a0c1d2e4b. */
export function uniqueName(prefix: string): string {
  return `${prefix}_${randomBytes(6).toString("hex")}`;
}

/** The same server URL, pointed at another database. */
export function databaseUrl(serverUrl: string, database: string): string {
  const url = new URL(serverUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

/** Runs one statement, such as create database, on its own connection. */
export async function adminQuery(
  serverUrl: string,
  sql: string,
): Promise<void> {
  const client = new pg.Client({ connectionString: serverUrl });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}
