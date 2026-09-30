// Serves the web app for the end-to-end tests: next dev on a fresh,
// migrated database with a login of its own, a random secret and the email
// outbox. next start would need Resend's key, since production sends real
// email. Playwright starts this script and stops it with SIGTERM, and the
// database goes with it.
//
// next dev compiles each page the first time it's asked for, so this
// script asks for every page first, and only then answers 200 on the
// readiness port that Playwright waits for. However it ends, it stops next
// dev and drops the database, its login and the outbox.
import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { createServer } from "node:http";

import { createAppDatabase } from "@beekeeping/db/testing/app-database";

import {
  checkBeforeStarting,
  nextDevFolder,
  startNextDev,
} from "../scripts/dev-server.ts";

const port = Number(process.env.E2E_PORT ?? 3190);
const readyPort = port + 1;
const outbox = process.env.E2E_OUTBOX ?? "";
if (!outbox) throw new Error("Set E2E_OUTBOX. playwright.config.ts does.");

const pages = [
  "/api/health",
  "/sign-in",
  "/sign-up",
  "/sign-in/two-factor",
  "/confirm-email",
  "/forgot-password",
  "/reset-password",
  "/invitations/none",
  "/",
  "/organizations/new",
  "/settings/account",
  "/settings/members",
  "/settings/audit",
];

// A next dev kept open from this checkout would lose its build below. Another
// process on either port would answer in place of this run's servers, and
// the tests' sign-ups could land in someone else's database.
await checkBeforeStarting(
  [port, readyPort],
  "Set E2E_PORT to a free port; a run also takes the port after it.",
);

// A dev cache left by another run can hold routes that moved.
rmSync(nextDevFolder, { recursive: true, force: true });
const database = await createAppDatabase();
// Made once the database exists, so a run that can't reach Postgres
// leaves no folder behind.
rmSync(outbox, { recursive: true, force: true });
mkdirSync(outbox, { recursive: true });

// The tests read their email from the outbox.
const server = startNextDev({
  port,
  databaseUrl: database.appUrl,
  secret: randomBytes(32).toString("hex"),
  outbox,
});

let ready = false;
const readiness = createServer((_request, response) => {
  response.statusCode = ready ? 200 : 503;
  response.end(ready ? "ready" : "compiling");
});

let stopping = false;
async function stop(code: number) {
  if (stopping) return;
  stopping = true;
  readiness.close();
  // A child that never started has nothing to stop. One that won't stop
  // gets 10 seconds.
  if (server.pid !== undefined && server.exitCode === null) {
    await new Promise((resolve) => {
      server.once("exit", resolve);
      server.kill("SIGTERM");
      setTimeout(resolve, 10_000).unref();
    });
  }
  await database.drop().catch(() => undefined);
  rmSync(outbox, { recursive: true, force: true });
  process.exit(code);
}

process.on("SIGTERM", () => void stop(0));
process.on("SIGINT", () => void stop(0));
server.on("exit", (code) => void stop(code ?? 1));
server.on("error", (error) => {
  console.error(`next dev didn't start: ${error.message}`);
  void stop(1);
});
readiness.on("error", (error) => {
  console.error(`The readiness port ${readyPort} failed: ${error.message}`);
  void stop(1);
});
readiness.listen(readyPort, "127.0.0.1");

/** Asks for a page until the server answers, and doesn't follow redirects. */
async function warm(path: string): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const answer = await fetch(`http://localhost:${port}${path}`, {
        redirect: "manual",
      });
      await answer.arrayBuffer();
      if (answer.status < 500) return;
    } catch {
      // The server isn't listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`${path} never answered.`);
}

try {
  for (const path of pages) await warm(path);
  ready = true;
} catch (error) {
  console.error(error instanceof Error ? error.message : "Warming up failed.");
  await stop(1);
}
