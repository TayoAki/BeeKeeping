// Where this checkout's local demo keeps what it made up: the demo people's
// password and the app's secret. `pnpm dev:demo` writes the file once, and
// the evidence helper reads it when DEMO_PASSWORD isn't set. It sits outside
// the repository, readable by its owner only, so no commit can carry it.
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { localDemoDatabase } from "@beekeeping/db/local";

export type LocalDemo = {
  /** The demo people's password, unless DEMO_PASSWORD says otherwise. */
  readonly password: string;
  /** BETTER_AUTH_SECRET for the demo, so sessions outlast a restart. */
  readonly secret: string;
};

const folder = process.env.BEEKEEPING_DEMO_DIR ?? "/tmp/beekeeping-demo";

/** This checkout's file, named after its demo database. */
export function localDemoFile(): string {
  return join(folder, `${localDemoDatabase()}.json`);
}

/** Where this checkout's demo sends its email, beside the file. */
export function localDemoOutbox(): string {
  return join(folder, `${localDemoDatabase()}-outbox`);
}

/** The local demo's password and secret, or undefined before its first run. */
export function readLocalDemo(): LocalDemo | undefined {
  try {
    const saved = JSON.parse(readFileSync(localDemoFile(), "utf8")) as Partial<
      Record<keyof LocalDemo, unknown>
    >;
    return typeof saved.password === "string" &&
      typeof saved.secret === "string"
      ? { password: saved.password, secret: saved.secret }
      : undefined;
  } catch {
    return undefined;
  }
}

/** The local demo's password and secret, made up and saved the first time. */
export function localDemo(): LocalDemo {
  const saved = readLocalDemo();
  if (saved) return saved;
  const made: LocalDemo = {
    password: randomBytes(18).toString("base64url"),
    secret: randomBytes(32).toString("hex"),
  };
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  // Written to a new file and moved into place, so the mode holds even when
  // a broken file was there before, and a reader never sees half of it.
  const file = localDemoFile();
  const fresh = `${file}.${process.pid}`;
  writeFileSync(fresh, `${JSON.stringify(made, null, 2)}\n`, { mode: 0o600 });
  renameSync(fresh, file);
  return made;
}

/**
 * The demo people's password, and where it comes from: DEMO_PASSWORD when
 * it's set, as in staging and PR environments, otherwise the local demo's
 * file. Undefined when there is neither. It never makes the file.
 */
export function demoPassword():
  { readonly password: string; readonly from: string } | undefined {
  const set = process.env.DEMO_PASSWORD;
  if (set) return { password: set, from: "DEMO_PASSWORD" };
  const saved = readLocalDemo();
  return saved
    ? { password: saved.password, from: localDemoFile() }
    : undefined;
}
