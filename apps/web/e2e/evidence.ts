// The evidence helper. It runs a flow in Chromium against the app, signed in
// as a person of the demo company, and writes what it saw to a folder:
// numbered screenshots, walkthrough.webm, and assertions.md, which names the
// commit and branch it tested and marks each check passed, failed or
// untested with a reason.
//
//   pnpm evidence <flow> --task <task> [--label <label>] [--url <app>]
//                [--out <folder>] [--dark]
//
// <flow> names a file in apps/web/e2e/flows, such as sign-in. The folder is
// .artifacts/<task> in this checkout, or .artifacts/<task>/<label> with a
// label such as before or after, unless --out names another. The app is at
// --url or EVIDENCE_URL. Without either, it's this checkout's
// `pnpm dev:demo`, on PORT or 3000, and the helper refuses to run when that
// isn't there. The demo people's password is DEMO_PASSWORD, or the local
// demo's.
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { chromium, type Page } from "@playwright/test";

import { demoPerson, type DemoRole } from "../scripts/demo-company.ts";
import { demoPassword } from "../scripts/demo-login.ts";
import { demoPort, runningDevServer } from "../scripts/dev-server.ts";
import {
  countResults,
  firstLine,
  renderReport,
  slug,
  type Line,
  type Result,
} from "./evidence-report.ts";
import { signIn } from "./helpers.ts";

/** What a flow gets: the page, and ways to record what it checks. */
export type Evidence = {
  readonly page: Page;
  /** Starts a step of the flow. */
  testStart: (name: string) => void;
  /**
   * Runs one check and records whether it passed, with a screenshot when
   * asked. A failed check doesn't stop the flow; the run fails at its end.
   */
  assertion: (
    name: string,
    check: () => Promise<void>,
    options?: { readonly shot?: boolean },
  ) => Promise<boolean>;
  /** Records a check the flow can't make here, and why. */
  untested: (name: string, reason: string) => void;
  /**
   * Signs in with the password form as a demo person, the owner unless
   * told otherwise, and records it as a check. It throws when sign-in
   * fails, since what follows needs it.
   */
  signIn: (role?: DemoRole) => Promise<void>;
};

export type Flow = {
  readonly title: string;
  run(evidence: Evidence): Promise<void>;
};

const repoRoot = resolve(import.meta.dirname, "..", "..", "..");

/**
 * Whether the app at a URL is the next dev this checkout runs. Only on
 * localhost: next dev serves its scripts to no other host unless told to,
 * so a page at 127.0.0.1 never comes to life.
 */
function servedFromHere(baseUrl: string): boolean {
  const running = runningDevServer();
  const url = new URL(baseUrl);
  return (
    running !== undefined &&
    url.hostname === "localhost" &&
    url.port === String(running.port)
  );
}

/**
 * The commit and branch the run tests, and whether the tree has changes.
 * Only this checkout's own next dev is known to run them.
 */
function commitLine(baseUrl: string): string {
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
  const commit = git("rev-parse", "--short", "HEAD");
  const branch = git("branch", "--show-current") || "a detached HEAD";
  const changed = git("status", "--porcelain") !== "";
  const here = `${commit} on ${branch}${changed ? ", with changes not yet committed" : ""}`;
  return servedFromHere(baseUrl)
    ? `Commit ${here}`
    : `An app this checkout doesn't run, so its commit is unknown (this checkout is at ${here})`;
}

/**
 * Runs a flow and writes its evidence to the folder. The last run's
 * screenshots, video and assertions.md go first; nothing else in the folder
 * changes. Answers the counts.
 */
async function recordEvidence(
  flow: Flow,
  {
    folder,
    baseUrl,
    colorScheme,
  }: {
    folder: string;
    baseUrl: string;
    colorScheme: "light" | "dark";
  },
): Promise<Record<Result, number>> {
  mkdirSync(folder, { recursive: true });
  for (const name of readdirSync(folder)) {
    if (/^\d\d-.*\.png$|^walkthrough\.webm$|^assertions\.md$/.test(name)) {
      rmSync(join(folder, name));
    }
  }
  const videoFolder = join(folder, ".video");
  rmSync(videoFolder, { recursive: true, force: true });

  const lines: Line[] = [];
  const startedAt = new Date();
  let shots = 0;
  // Ctrl-C is this helper's to handle, below, so the report still gets
  // written.
  const browser = await chromium.launch({ handleSIGINT: false });
  const context = await browser.newContext({
    baseURL: baseUrl,
    colorScheme,
    viewport: { width: 1280, height: 800 },
    recordVideo: { dir: videoFolder, size: { width: 1280, height: 800 } },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  const elapsed = () => Date.now() - startedAt.getTime();

  const assertion: Evidence["assertion"] = async (
    name,
    check,
    { shot = false } = {},
  ) => {
    let result: Result = "passed";
    let reason: string | undefined;
    try {
      await check();
    } catch (error) {
      result = "failed";
      reason = firstLine(error);
    }
    let file: string | undefined;
    if (shot) {
      shots += 1;
      file = `${String(shots).padStart(2, "0")}-${slug(name)}-${result}.png`;
      // Hiding the caret styles every input, and React calls that a
      // mismatch if it lands before the page has hydrated.
      await page.screenshot({ path: join(folder, file), caret: "initial" });
      // Hold the frame, so the video shows this state. Ctrl-C may end the
      // hold, and the check still gets its line.
      await page.waitForTimeout(700).catch(() => undefined);
    }
    lines.push({
      kind: "check",
      at: elapsed(),
      name,
      result,
      reason,
      shot: file,
    });
    return result === "passed";
  };

  const evidence: Evidence = {
    page,
    testStart: (name) => lines.push({ kind: "step", at: elapsed(), name }),
    assertion,
    untested: (name, reason) =>
      lines.push({
        kind: "check",
        at: undefined,
        name,
        result: "untested",
        reason,
      }),
    signIn: async (role = "owner") => {
      const person = demoPerson(role);
      const signedIn = await assertion(
        `${person.name} (${person.role}, ${person.email}) signs in with the password`,
        async () => {
          const login = demoPassword();
          if (!login) {
            throw new Error(
              "Set DEMO_PASSWORD, or run pnpm dev:demo once, which makes the local demo's.",
            );
          }
          await signIn(page, { email: person.email, password: login.password });
        },
      );
      if (!signedIn) throw new Error(`${person.email} couldn't sign in.`);
    },
  };

  // Ctrl-C closes the browser, so whatever the flow waits for fails, and
  // the report still says how far it got.
  const interrupt = () => {
    lines.push({
      kind: "check",
      at: elapsed(),
      name: "the run finished",
      result: "failed",
      reason: "It was stopped with Ctrl-C.",
    });
    void browser.close();
  };
  process.once("SIGINT", interrupt);
  try {
    await flow.run(evidence);
  } catch (error) {
    lines.push({
      kind: "check",
      at: elapsed(),
      name: "the flow ran to its end",
      result: "failed",
      reason: firstLine(error),
    });
  }
  process.off("SIGINT", interrupt);
  const video = page.video();
  await context.close().catch(() => undefined);
  await browser.close().catch(() => undefined);
  try {
    if (video) renameSync(await video.path(), join(folder, "walkthrough.webm"));
  } catch (error) {
    // Such as a page that never drew a frame, when the app didn't answer.
    lines.push({
      kind: "check",
      at: undefined,
      name: "walkthrough.webm",
      result: "untested",
      reason: firstLine(error),
    });
  }
  rmSync(videoFolder, { recursive: true, force: true });

  writeFileSync(
    join(folder, "assertions.md"),
    renderReport({
      title: flow.title,
      commit: commitLine(baseUrl),
      baseUrl,
      startedAt,
      lines,
    }),
  );
  return countResults(lines);
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      task: { type: "string" },
      label: { type: "string" },
      url: { type: "string" },
      out: { type: "string" },
      dark: { type: "boolean", default: false },
    },
  });
  const [flowName] = positionals;
  // Names that stay inside .artifacts: no dots or slashes up front.
  const folderName = /^[A-Za-z0-9][A-Za-z0-9.-]*$/;
  if (
    !flowName ||
    !/^[a-z0-9-]+$/.test(flowName) ||
    !values.task ||
    !folderName.test(values.task) ||
    (values.label !== undefined && !folderName.test(values.label))
  ) {
    console.error(
      "Usage: pnpm evidence <flow> --task <task, such as P0.8> [--label <label, such as before>] [--url <app>] [--out <folder>] [--dark]",
    );
    process.exit(1);
  }
  // An empty EVIDENCE_URL counts as none.
  const named = values.url || process.env.EVIDENCE_URL || undefined;
  const baseUrl = named ?? `http://localhost:${demoPort()}`;
  // A typo such as 127.0.0.1:3159 would otherwise run the whole flow, then
  // fail before the report, with the last run's evidence already gone.
  if (
    !URL.canParse(baseUrl) ||
    !["http:", "https:"].includes(new URL(baseUrl).protocol)
  ) {
    console.error(
      "--url and EVIDENCE_URL take a whole address, such as http://localhost:3000.",
    );
    process.exit(1);
  }
  if (named === undefined && !servedFromHere(baseUrl)) {
    console.error(
      `pnpm dev:demo from this checkout isn't running on port ${demoPort()}. Start it, or name the app with --url.`,
    );
    process.exit(1);
  }
  const file = join(import.meta.dirname, "flows", `${flowName}.ts`);
  const flow = ((await import(file)) as { default: Flow }).default;
  // pnpm runs this from apps/web; --out starts where the person typed it.
  const folder = values.out
    ? resolve(process.env.INIT_CWD ?? process.cwd(), values.out)
    : join(repoRoot, ".artifacts", values.task, values.label ?? "");
  const counts = await recordEvidence(flow, {
    folder,
    baseUrl,
    colorScheme: values.dark ? "dark" : "light",
  });
  console.log(
    `${counts.passed} passed, ${counts.failed} failed, ${counts.untested} untested. Evidence in ${folder}.`,
  );
  process.exitCode = counts.failed === 0 ? 0 : 1;
}

if (process.argv[1] === import.meta.filename) await main();
