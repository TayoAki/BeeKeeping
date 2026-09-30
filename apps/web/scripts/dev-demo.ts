// Runs the web app on the demo company, to look at a change or record
// evidence of it. It starts the throwaway Postgres when needed, migrates
// this checkout's demo database, loads the demo company into it with
// seed-demo.ts, and starts next dev with the email outbox. --fresh starts
// from an empty database.
//
//   pnpm dev:demo [--fresh]     (PORT picks the port, 3000 unless set)
//
// The demo people sign in with DEMO_PASSWORD when it's set, otherwise with
// a password made up once and kept in the file this prints, never in the
// terminal.
import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { localDemoDatabase, prepareLocalDatabase } from "@beekeeping/db/local";

import { demoCompany, demoPerson } from "./demo-company.ts";
import {
  demoPassword,
  localDemo,
  localDemoFile,
  localDemoOutbox,
} from "./demo-login.ts";
import { checkBeforeStarting, demoPort, startNextDev } from "./dev-server.ts";

const port = demoPort();

// Before touching the database: --fresh would drop it under a running
// demo, and next dev would then fail to start anyway.
await checkBeforeStarting([port], "Set PORT to a free one.");

const database = localDemoDatabase();
const appUrl = await prepareLocalDatabase(database, {
  fresh: process.argv.includes("--fresh"),
});

const { secret } = localDemo();
// localDemo() made the file if it was missing, so there is a password.
const login = demoPassword();
if (!login) throw new Error(`${localDemoFile()} holds no password.`);

// The seed staging runs, in a process of its own, so this one holds only
// next dev while the demo runs.
const seed = spawnSync(
  process.execPath,
  [join(import.meta.dirname, "seed-demo.ts")],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: appUrl,
      DEMO_PASSWORD: login.password,
    },
  },
);
if (seed.status !== 0) process.exit(seed.status ?? 1);

const owner = demoPerson();
const outbox = localDemoOutbox();
console.log(
  `Sign in at http://localhost:${port}/sign-in as ${owner.email} (${owner.role}), with the password in ${login.from}. Emails go to ${outbox}.`,
);

const server = startNextDev({
  port,
  databaseUrl: appUrl,
  secret,
  outbox,
  emailFrom: demoCompany.emailFrom,
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.kill(signal));
}
server.on("exit", (code) => process.exit(code ?? 0));
