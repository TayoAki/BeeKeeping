// Code that runs in the browser imports nothing that reaches the database or
// the server. Next.js would put it in the page's bundle: a build fails on
// pg's Node modules, and anything that did bundle would ship server code.
// Client code is every file that starts with "use client", and the helpers
// in apps/web/src/lib. It may use the entries of @beekeeping/actions that
// hold only rules, such as @beekeeping/actions/access.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const web = join(root, "apps/web/src");

const serverOnly = [
  /from "@beekeeping\/actions"/,
  /from "@beekeeping\/db(\/[^"]*)?"/,
  /from "@beekeeping\/services(\/[^"]*)?"/,
  /from "(\.\.?\/)+server\//,
  /from "next\/headers"/,
];

function files(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) return files(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
      ? [path]
      : [];
  });
}

function isClientCode(path: string, text: string): boolean {
  return (
    /^\s*["']use client["'];?/.test(text) ||
    relative(web, path).startsWith("lib/")
  );
}

describe("client code", () => {
  const client = files(web)
    .map((path) => ({ path, text: readFileSync(path, "utf8") }))
    .filter(({ path, text }) => isClientCode(path, text));

  it("is found", () => {
    expect(client.length).toBeGreaterThan(10);
  });

  it("imports nothing that reaches the database or the server", () => {
    const found = client.flatMap(({ path, text }) =>
      text
        .split("\n")
        .filter((line) => serverOnly.some((pattern) => pattern.test(line)))
        .map((line) => `${relative(root, path)}: ${line.trim()}`),
    );
    expect(found).toEqual([]);
  });
});
