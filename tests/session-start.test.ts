import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const hook = join(root, ".claude/hooks/session-start.sh");

const made: string[] = [];
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  made.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of made.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

// Runs the hook with only the variables it needs, as a fresh session would.
// HOME points at a temp folder so pnpm leaves nothing in the real one.
function runHook(env: Record<string, string>, path = process.env.PATH ?? "") {
  return spawnSync("bash", [hook], {
    encoding: "utf8",
    timeout: 30_000,
    env: { PATH: path, HOME: tempDir("session-start-home-"), ...env },
  });
}

// Stand-ins for pnpm, npm, node and, when asked, ocr. Each logs how it was
// called, so the cloud path runs offline and fast.
function runWithStubs({
  ocr,
  npmExit = 0,
}: {
  ocr: boolean;
  npmExit?: number;
}) {
  const bin = tempDir("session-start-bin-");
  const calls = join(bin, "calls.log");
  const stub = (name: string, body: string) => {
    writeFileSync(
      join(bin, name),
      `#!/bin/sh\necho "${name} $*" >>"${calls}"\n${body}\n`,
      { mode: 0o755 },
    );
  };
  stub(
    "pnpm",
    '[ "$1" = --version ] && echo 10.33.0 && exit 0\necho "noisy install output"',
  );
  stub("node", "echo v22.0.0");
  stub("npm", `echo "noisy npm output"\nexit ${npmExit}`);
  if (ocr) stub("ocr", "exit 0");

  const project = tempDir("session-start-project-");
  const envFile = join(project, "session.env");
  const result = runHook(
    {
      CLAUDE_CODE_REMOTE: "true",
      CLAUDE_PROJECT_DIR: project,
      CLAUDE_ENV_FILE: envFile,
    },
    `${bin}:/usr/bin:/bin`,
  );
  const log = existsSync(calls) ? readFileSync(calls, "utf8") : "";
  return { result, log, envFile };
}

type Settings = {
  hooks?: { SessionStart?: { hooks: { command: string }[] }[] };
};

describe("the SessionStart hook", () => {
  it("is registered in .claude/settings.json and executable", () => {
    const settings = JSON.parse(
      readFileSync(join(root, ".claude/settings.json"), "utf8"),
    ) as Settings;
    const commands = (settings.hooks?.SessionStart ?? []).flatMap((entry) =>
      entry.hooks.map(({ command }) => command),
    );
    expect(commands).toEqual([
      '"$CLAUDE_PROJECT_DIR"/.claude/hooks/session-start.sh',
    ]);
    expect(statSync(hook).mode & 0o111).not.toBe(0);
  });

  it("does nothing outside Claude Code on the web", () => {
    const project = tempDir("session-start-project-");
    const result = runHook({ CLAUDE_PROJECT_DIR: project });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  it("installs with a frozen lockfile, never prompts, and prints one line", () => {
    const { result, log } = runWithStubs({ ocr: true });
    expect(result.status).toBe(0);
    expect(log).toContain(
      "pnpm install --frozen-lockfile --config.confirmModulesPurge=false",
    );
    expect(result.stdout.trimEnd().split("\n")).toHaveLength(1);
    expect(result.stdout).toMatch(/^session-start: installed the workspace/);
  });

  it("leaves an ocr that is already there alone", () => {
    const { log } = runWithStubs({ ocr: true });
    expect(log).not.toMatch(/^npm /m);
  });

  it("installs the pinned ocr when it is missing", () => {
    const { result, log } = runWithStubs({ ocr: false });
    expect(result.status).toBe(0);
    expect(log).toContain(
      "npm install --global @alibaba-group/open-code-review@1.12.10",
    );
  });

  it("fails when the ocr install fails", () => {
    const { result } = runWithStubs({ ocr: false, npmExit: 1 });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("installing the ocr CLI failed");
  });

  it("writes each session variable once, however often it runs", () => {
    const { envFile } = runWithStubs({ ocr: true });
    const bin = tempDir("session-start-bin-");
    writeFileSync(join(bin, "pnpm"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    writeFileSync(join(bin, "node"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    writeFileSync(join(bin, "ocr"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    runHook(
      {
        CLAUDE_CODE_REMOTE: "true",
        CLAUDE_PROJECT_DIR: tempDir("session-start-project-"),
        CLAUDE_ENV_FILE: envFile,
      },
      `${bin}:/usr/bin:/bin`,
    );
    expect(readFileSync(envFile, "utf8").trimEnd().split("\n")).toEqual([
      "export npm_config_update_notifier=false",
      "export pnpm_config_update_notifier=false",
      "export NEXT_TELEMETRY_DISABLED=1",
    ]);
  });

  it("fails and shows pnpm's output when the install fails", () => {
    // A dependency with no lockfile: a frozen install refuses it at once.
    const project = tempDir("session-start-project-");
    writeFileSync(
      join(project, "package.json"),
      JSON.stringify({
        name: "probe",
        private: true,
        dependencies: { zod: "4.0.0" },
      }),
    );
    const result = runHook({
      CLAUDE_CODE_REMOTE: "true",
      CLAUDE_PROJECT_DIR: project,
      CLAUDE_ENV_FILE: join(project, "session.env"),
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("pnpm install --frozen-lockfile failed");
    expect(result.stderr).toContain("ERR_PNPM");
  });
});
