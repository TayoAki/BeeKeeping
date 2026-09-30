// Starting next dev from this checkout, shared by `pnpm dev:demo` and the
// end-to-end tests' server.
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";

const appFolder = join(import.meta.dirname, "..");

/** Where next dev keeps its build. It allows one server per checkout. */
export const nextDevFolder = join(appFolder, ".next", "dev");

/** The port `pnpm dev:demo` serves and the evidence helper tests: PORT, or 3000. */
export function demoPort(): number {
  return Number(process.env.PORT ?? 3000);
}

/** A next dev this checkout already runs, from Next.js's own lock file. */
export function runningDevServer(): { pid: number; port: unknown } | undefined {
  let lock: { pid?: unknown; port?: unknown };
  try {
    lock = JSON.parse(
      readFileSync(join(nextDevFolder, "lock"), "utf8"),
    ) as typeof lock;
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

/** Whether nothing listens on a port yet. */
function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer()
      .once("error", () => resolve(false))
      .once("listening", () => probe.close(() => resolve(true)))
      .listen(port);
  });
}

/**
 * Exits with a message when next dev from this checkout already runs, since
 * a second one can't start, or when a port is taken, since another process
 * would answer in place of this one. It comes before any database work.
 */
export async function checkBeforeStarting(
  ports: readonly number[],
  portHelp: string,
): Promise<void> {
  const running = runningDevServer();
  if (running) {
    console.error(
      `next dev from this checkout is running on port ${String(running.port)} (process ${running.pid}). Stop it first.`,
    );
    process.exit(1);
  }
  for (const port of ports) {
    if (!(await portFree(port))) {
      console.error(`Port ${port} is taken. ${portHelp}`);
      process.exit(1);
    }
  }
}

/**
 * Starts next dev with the settings the app needs. A Resend key in the
 * shell stays out, so local email always goes to the outbox.
 */
export function startNextDev({
  port,
  databaseUrl,
  secret,
  outbox,
  emailFrom,
}: {
  port: number;
  databaseUrl: string;
  secret: string;
  outbox: string;
  emailFrom?: string;
}): ChildProcess {
  const { RESEND_API_KEY: _resendKey, ...inherited } = process.env;
  return spawn(
    join(appFolder, "node_modules", ".bin", "next"),
    ["dev", "--port", String(port)],
    {
      cwd: appFolder,
      stdio: "inherit",
      env: {
        ...inherited,
        DATABASE_URL: databaseUrl,
        BETTER_AUTH_SECRET: secret,
        BETTER_AUTH_URL: `http://localhost:${port}`,
        BEEKEEPING_OUTBOX_DIR: outbox,
        ...(emailFrom === undefined ? {} : { EMAIL_FROM: emailFrom }),
        NEXT_TELEMETRY_DISABLED: "1",
      },
    },
  );
}
