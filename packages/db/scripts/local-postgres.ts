// Starts and stops the throwaway Postgres that development and tests use when
// no DATABASE_URL or TEST_DATABASE_ADMIN_URL is set. It runs the Postgres
// installed on the machine (the cloud image has Postgres 16), so it needs no
// Docker. CI uses its own Postgres service instead.
//
//   node scripts/local-postgres.ts start | stop | status | url
//
// One server serves every checkout and worktree on the machine, so stop
// stops it for all of them. Each checkout gets its own development database.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chownSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const port = Number(process.env.BEEKEEPING_PG_PORT ?? 54320);
const home = process.env.BEEKEEPING_PG_DIR ?? "/tmp/beekeeping-postgres";
const dataDir = join(home, "data");
const logFile = join(home, "postgres.log");
const lockDir = `${home}.lock`;

/** The superuser URL of the throwaway server. */
export const localAdminUrl = `postgres://postgres@127.0.0.1:${port}/postgres`;

/**
 * This checkout's development database, such as beekeeping_dev_3f9a0c1d. Each
 * worktree has its own, so migrations on one branch never land in another's.
 */
export function localDevelopmentDatabase(): string {
  const checkout = resolve(import.meta.dirname, "..", "..", "..");
  const hash = createHash("sha256").update(checkout).digest("hex").slice(0, 8);
  return `beekeeping_dev_${hash}`;
}

export function localDevelopmentUrl(): string {
  return `postgres://postgres@127.0.0.1:${port}/${localDevelopmentDatabase()}`;
}

/** Version folders as numbers, so 16 wins over 9.6 and our pinned 16 first. */
function versionFolders(): string[] {
  const root = "/usr/lib/postgresql";
  if (!existsSync(root)) return [];
  const versions = readdirSync(root)
    .filter((name) => /^\d+(\.\d+)?$/.test(name))
    .sort((a, b) => Number(b) - Number(a));
  const pinned = versions.filter((version) => version === "16");
  const others = versions.filter((version) => version !== "16");
  return [...pinned, ...others].map((version) => `${root}/${version}/bin`);
}

function binDir(): string {
  const candidates = [
    process.env.BEEKEEPING_PG_BIN,
    ...versionFolders(),
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

/**
 * Holds a lock while it starts the server, so two test runs starting at once
 * don't both run initdb. A lock older than two minutes belongs to a run that
 * died, so it's taken over.
 */
async function withLock<T>(work: () => T): Promise<T> {
  mkdirSync(dirname(lockDir), { recursive: true });
  const deadline = Date.now() + 120_000;
  for (;;) {
    try {
      mkdirSync(lockDir);
      break;
    } catch {
      const stale =
        existsSync(lockDir) && Date.now() - statSync(lockDir).mtimeMs > 120_000;
      if (stale) rmSync(lockDir, { recursive: true, force: true });
      else if (Date.now() > deadline) {
        throw new Error(`Timed out waiting for ${lockDir}`);
      } else await sleep(200);
    }
  }
  try {
    return work();
  } finally {
    rmSync(lockDir, { recursive: true, force: true });
  }
}

function initialize(): void {
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

/** Starts the server if it isn't running and returns its superuser URL. */
export async function startLocalPostgres(): Promise<string> {
  if (isReady()) return localAdminUrl;
  return withLock(() => {
    // Another run may have started it while this one waited for the lock.
    if (isReady()) return localAdminUrl;
    if (!existsSync(join(dataDir, "PG_VERSION"))) initialize();
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
    if (!start.ok && !isReady()) {
      throw new Error(`Postgres didn't start:\n${start.output}`);
    }
    return localAdminUrl;
  });
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
      console.log(`Postgres is running at ${await startLocalPostgres()}`);
      console.log(`This checkout's database: ${localDevelopmentUrl()}`);
      break;
    case "stop":
      stopLocalPostgres();
      console.log("Postgres stopped, for every checkout on this machine.");
      break;
    case "status":
      console.log(isReady() ? `running at ${localAdminUrl}` : "stopped");
      break;
    case "url":
      console.log(localDevelopmentUrl());
      break;
    default:
      console.error("Usage: local-postgres.ts start | stop | status | url");
      process.exitCode = 1;
  }
}
