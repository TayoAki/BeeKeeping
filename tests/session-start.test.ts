import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const hook = join(root, ".claude/hooks/session-start.sh");

// Runs the hook with only the variables it needs, as a fresh session would.
function runHook(env: Record<string, string>) {
  return spawnSync("bash", [hook], {
    encoding: "utf8",
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      ...env,
    },
  });
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
    const project = mkdtempSync(join(tmpdir(), "session-start-"));
    const result = runHook({ CLAUDE_PROJECT_DIR: project });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("fails and shows pnpm's output when the install fails", () => {
    // A dependency with no lockfile: a frozen install refuses it at once.
    const project = mkdtempSync(join(tmpdir(), "session-start-"));
    writeFileSync(
      join(project, "package.json"),
      JSON.stringify({
        name: "probe",
        private: true,
        dependencies: { zod: "4.0.0" },
      }),
    );
    const envFile = join(project, "session.env");

    const result = runHook({
      CLAUDE_CODE_REMOTE: "true",
      CLAUDE_PROJECT_DIR: project,
      CLAUDE_ENV_FILE: envFile,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("pnpm install --frozen-lockfile failed");
    expect(result.stderr).toContain("ERR_PNPM");
    expect(readFileSync(envFile, "utf8")).toContain(
      "export NEXT_TELEMETRY_DISABLED=1",
    );
  });
});
