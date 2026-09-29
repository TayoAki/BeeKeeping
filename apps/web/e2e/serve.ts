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
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { createServer as createProbe } from "node:net";

import { createAppDatabase } from "@beekeeping/db/testing/app-database";

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
];

/** A next dev this checkout already runs, from Next.js's own lock file. */
function runningDevServer(): { pid: number; port: unknown } | undefined {
  let lock: { pid?: unknown; port?: unknown };
  try {
    lock = JSON.parse(readFileSync(".next/dev/lock", "utf8")) as typeof lock;
  } catch {
    return undefined;
  }
  if (typeof lock.pid !== "number") return undefined;
  try {
    process.kill(lock.pid, 0);
  } catch (error) {
    // EPERM means the process is there, run by someone else.
    if ((error as { code?: string }).code !== "EPERM") return undefined;
  }
  return { pid: lock.pid, port: lock.port };
}

// next dev keeps its build in .next/dev and allows one server per
// checkout. A next dev kept open here would lose its build below, and this
// run couldn't start its own.
const running = runningDevServer();
if (running) {
  console.error(
    `next dev from this checkout is running on port ${String(running.port)} (process ${running.pid}). Stop it, then run the tests again.`,
  );
  process.exit(1);
}

/** Whether nothing listens on a port yet. */
function portFree(candidate: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createProbe()
      .once("error", () => resolve(false))
      .once("listening", () => probe.close(() => resolve(true)))
      .listen(candidate);
  });
}

// Another process on either port would answer in place of this run's
// servers, and the tests' sign-ups could land in someone else's database.
for (const candidate of [port, readyPort]) {
  if (!(await portFree(candidate))) {
    console.error(
      `Port ${candidate} is taken. Set E2E_PORT to a free port; a run also takes the port after it.`,
    );
    process.exit(1);
  }
}

// A dev cache left by another run can hold routes that moved.
rmSync(".next/dev", { recursive: true, force: true });
const database = await createAppDatabase();
// Made once the database exists, so a run that can't reach Postgres
// leaves no folder behind.
rmSync(outbox, { recursive: true, force: true });
mkdirSync(outbox, { recursive: true });

// A Resend key in the shell would send the tests' email for real, and the
// tests read theirs from the outbox.
const { RESEND_API_KEY: _resendKey, ...inherited } = process.env;
const server = spawn(
  "./node_modules/.bin/next",
  ["dev", "--port", String(port)],
  {
    stdio: "inherit",
    env: {
      ...inherited,
      DATABASE_URL: database.appUrl,
      BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
      BETTER_AUTH_URL: `http://localhost:${port}`,
      BEEKEEPING_OUTBOX_DIR: outbox,
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
);

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
