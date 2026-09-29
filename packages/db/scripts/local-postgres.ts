// Starts and stops the throwaway Postgres that development and tests use when
// no DATABASE_URL or TEST_DATABASE_ADMIN_URL is set. It runs the Postgres
// installed on the machine (the cloud image has Postgres 16), so it needs no
// Docker. CI uses its own Postgres service instead.
//
//   node scripts/local-postgres.ts start | stop | status | url

import { spawnSync } from "node:child_process";
import { chownSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const port = Number(process.env.BEEKEEPING_PG_PORT ?? 54320);
const home = process.env.BEEKEEPING_PG_DIR ?? "/tmp/beekeeping-postgres";
const dataDir = join(home, "data");
const logFile = join(home, "postgres.log");

/** The superuser URL of the throwaway server. */
export const localAdminUrl = `postgres://postgres@127.0.0.1:${port}/postgres`;

function binDir(): string {
  const candidates = [
    process.env.BEEKEEPING_PG_BIN,
    ...(existsSync("/usr/lib/postgresql")
      ? readdirSync("/usr/lib/postgresql")
          .sort()
          .reverse()
          .map((version) => `/usr/lib/postgresql/${version}/bin`)
      : []),
    "/opt/homebrew/opt/postgresql@16/bin",
    "/usr/local/opt/postgresql@16/bin",
  ];
  const found = candidates.find(
    (dir) => dir !== undefined && existsSync(join(dir, "pg_ctl")),
  );
  if (!found) {
    throw new Error(
      "No Postgres server found. Install Postgres 16, set BEEKEEPING_PG_BIN to its bin folder, or set DATABASE_URL.",
    );
  }
  return found;
}

// Postgres refuses to run as root, so root runs it as the postgres user.
const asRoot = process.getuid?.() === 0;

function run(program: string, args: string[]) {
  const command = join(binDir(), program);
  const result = asRoot
    ? spawnSync("runuser", ["-u", "postgres", "--", command, ...args], {
        encoding: "utf8",
      })
    : spawnSync(command, args, { encoding: "utf8" });
  return {
    ok: result.status === 0,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim(),
  };
}

function isReady(): boolean {
  return run("pg_isready", ["-h", "127.0.0.1", "-p", String(port)]).ok;
}

/** Starts the server if it isn't running and returns its superuser URL. */
export function startLocalPostgres(): string {
  if (isReady()) return localAdminUrl;

  if (!existsSync(join(dataDir, "PG_VERSION"))) {
    mkdirSync(dataDir, { recursive: true });
    if (asRoot) {
      const owner = spawnSync("id", ["-u", "postgres"], { encoding: "utf8" });
      const group = spawnSync("id", ["-g", "postgres"], { encoding: "utf8" });
      for (const dir of [home, dataDir]) {
        chownSync(dir, Number(owner.stdout), Number(group.stdout));
      }
    }
    const init = run("initdb", [
      "-D",
      dataDir,
      "-U",
      "postgres",
      "--auth=trust",
      "--encoding=UTF8",
      "--locale=C.UTF-8",
    ]);
    if (!init.ok) throw new Error(`initdb failed:\n${init.output}`);
  }

  const start = run("pg_ctl", [
    "-D",
    dataDir,
    "-l",
    logFile,
    "-w",
    "-o",
    `-p ${port} -k "${home}" -c listen_addresses=127.0.0.1`,
    "start",
  ]);
  // Another test run may have started it a moment ago.
  if (!start.ok && !isReady()) {
    throw new Error(`Postgres didn't start:\n${start.output}`);
  }
  return localAdminUrl;
}

export function stopLocalPostgres(): void {
  if (!existsSync(join(dataDir, "PG_VERSION")) || !isReady()) return;
  const stop = run("pg_ctl", ["-D", dataDir, "-m", "fast", "-w", "stop"]);
  if (!stop.ok) throw new Error(`Postgres didn't stop:\n${stop.output}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const command = process.argv[2] ?? "";
  switch (command) {
    case "start":
      console.log(`Postgres is running at ${startLocalPostgres()}`);
      break;
    case "stop":
      stopLocalPostgres();
      console.log("Postgres stopped.");
      break;
    case "status":
      console.log(isReady() ? `running at ${localAdminUrl}` : "stopped");
      break;
    case "url":
      console.log(localAdminUrl);
      break;
    default:
      console.error("Usage: local-postgres.ts start | stop | status | url");
      process.exitCode = 1;
  }
}
