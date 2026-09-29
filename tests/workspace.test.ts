import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ESLint } from "eslint";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// Guards against checks that quietly skip part of the workspace: a package
// with no typecheck script, a looser tsconfig, or no layer rule in the lint
// config would otherwise pass CI without being checked.

const root = join(import.meta.dirname, "..");
const eslint = new ESLint({ cwd: root });

const packageDirs = ["apps", "packages"].flatMap((group) =>
  readdirSync(join(root, group), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `${group}/${entry.name}`),
);

// strict turns these on, and a tsconfig can still turn any one of them off.
const strictFamily = [
  "alwaysStrict",
  "noImplicitAny",
  "noImplicitThis",
  "strictBindCallApply",
  "strictBuiltinIteratorReturn",
  "strictFunctionTypes",
  "strictNullChecks",
  "strictPropertyInitialization",
  "useUnknownInCatchVariables",
] as const;

type Manifest = {
  name?: string;
  private?: boolean;
  type?: string;
  exports?: Record<string, string>;
  scripts?: Record<string, string>;
};

function readManifest(dir: string): Manifest {
  return JSON.parse(
    readFileSync(join(root, dir, "package.json"), "utf8"),
  ) as Manifest;
}

function effectiveCompilerOptions(dir: string): ts.CompilerOptions {
  const file = ts.readConfigFile(join(root, dir, "tsconfig.json"), (path) =>
    ts.sys.readFile(path),
  );
  if (file.error) {
    throw new Error(
      ts.flattenDiagnosticMessageText(file.error.messageText, "\n"),
    );
  }
  return ts.parseJsonConfigFileContent(file.config, ts.sys, join(root, dir))
    .options;
}

it("fails the test run on a test marked .only", () => {
  const manifest = JSON.parse(
    readFileSync(join(root, "package.json"), "utf8"),
  ) as Manifest;
  expect(manifest.scripts?.test).toContain("--allowOnly=false");
});

it("finds the apps and packages from the build plan", () => {
  expect(packageDirs).toEqual(
    expect.arrayContaining([
      "apps/web",
      "apps/worker",
      "packages/actions",
      "packages/db",
      "packages/mcp",
      "packages/services",
      "packages/testing",
      "packages/ui",
    ]),
  );
});

describe.each(packageDirs)("%s", (dir) => {
  const manifest = readManifest(dir);

  it("is a private ES module package named after its folder", () => {
    expect(manifest.name).toBe(`@beekeeping/${dir.split("/")[1]}`);
    expect(manifest.private).toBe(true);
    expect(manifest.type).toBe("module");
  });

  it("runs tsc in its typecheck script", () => {
    expect(manifest.scripts?.typecheck).toMatch(/(^|&& )tsc$/);
  });

  it("type checks with the strict settings of tsconfig.base.json", () => {
    const options = effectiveCompilerOptions(dir);
    for (const flag of strictFamily) {
      expect(options[flag], flag).not.toBe(false);
    }
    expect(options).toMatchObject({
      strict: true,
      noUncheckedIndexedAccess: true,
      noImplicitOverride: true,
      noImplicitReturns: true,
      noFallthroughCasesInSwitch: true,
      allowUnreachableCode: false,
      allowUnusedLabels: false,
      verbatimModuleSyntax: true,
      erasableSyntaxOnly: true,
    });
  });

  it("has layer rules in eslint.config.js", async () => {
    const config = (await eslint.calculateConfigForFile(
      join(root, dir, "src/index.ts"),
    )) as {
      rules?: Record<string, [number, { refuse?: string[] }?]>;
    };
    const [severity, options] = config.rules?.["beekeeping/imports"] ?? [];
    expect(severity).toBe(2);
    expect(
      options?.refuse?.some((name) => name.startsWith("@beekeeping/")),
    ).toBe(true);
  });

  if (dir.startsWith("packages/")) {
    it("exports its TypeScript source", () => {
      expect(manifest.exports?.["."]).toBe("./src/index.ts");
      for (const target of Object.values(manifest.exports ?? {})) {
        expect(existsSync(join(root, dir, target))).toBe(true);
      }
    });
  }
});
