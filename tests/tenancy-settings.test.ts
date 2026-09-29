// runAction is the only code that sets app.org_id and app.user_id, and no
// code switches roles once connected. Code that did either could reach any
// organization's rows, or sign-in's tables. This test reads the source of
// the apps and packages, leaving out tests and test helpers, and fails on
// SQL that could, anywhere but runAction.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const runActionFile = "packages/actions/src/context.ts";

const risky = [
  /set_config\s*\(/gi,
  /\bset\s+(local\s+|session\s+)?role\b/gi,
  /\bsession\s+authorization\b/gi,
  /\bset\s+(local\s+|session\s+)?app\./gi,
];
// Startup options in a URL or a pool's config, and pools that run as Better
// Auth. They belong in openDatabase and in Better Auth's own setup only.
const pools = [/-c\s*(role|app\.)/gi, /\brole:\s*["']auth["']/g];
const poolFiles = new Set([
  "packages/db/src/client.ts",
  "apps/web/src/server/auth.ts",
  "apps/web/src/server/auth-test-browser.ts",
]);

/** The code without comments, so prose in a comment never matches. */
function withoutComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** The .ts and .tsx files under folder, without tests or test helpers. */
function sourceFiles(folder: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== "testing") {
        found.push(...sourceFiles(path));
      }
    } else if (
      /\.tsx?$/.test(entry.name) &&
      !/\.test\.tsx?$/.test(entry.name)
    ) {
      found.push(path);
    }
  }
  return found;
}

function sourceFolders(): string[] {
  return ["apps", "packages"].flatMap((group) =>
    readdirSync(join(root, group), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== "testing")
      .map((entry) => join(root, group, entry.name, "src"))
      .filter((folder) => existsSync(folder)),
  );
}

/**
 * "file:line" for each match of a risky pattern, across line breaks too,
 * leaving comments out.
 */
function riskyLines(file: string): string[] {
  const name = relative(root, file);
  const code = withoutComments(readFileSync(file, "utf8"));
  const patterns = poolFiles.has(name) ? risky : [...risky, ...pools];
  return patterns
    .flatMap((pattern) => [...code.matchAll(pattern)])
    .map((match) => `${name}:${code.slice(0, match.index).split("\n").length}`);
}

describe("tenancy settings", () => {
  it("are set only by runAction, and no code switches roles", () => {
    const files = sourceFolders().flatMap((folder) => sourceFiles(folder));
    expect(files.length).toBeGreaterThan(20);
    const found = files
      .filter((file) => relative(root, file) !== runActionFile)
      .flatMap((file) => riskyLines(file));
    expect(found).toEqual([]);
  });

  it("finds runAction's own set_config, so the scan works", () => {
    expect(riskyLines(join(root, runActionFile))).not.toEqual([]);
  });
});
