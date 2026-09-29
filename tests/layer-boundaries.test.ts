import { readdirSync } from "node:fs";
import { join } from "node:path";

import { ESLint } from "eslint";
import tseslint from "typescript-eslint";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");

// Lints a snippet as if it sat in the given file. Type information is off
// because the import rule doesn't need it and the file doesn't exist.
const eslint = new ESLint({
  cwd: root,
  overrideConfig: tseslint.configs.disableTypeChecked,
});

async function importErrors(file: string, code: string) {
  const [result] = await eslint.lintText(code, { filePath: file });
  const messages = result?.messages ?? [];
  expect(messages.filter((message) => message.fatal)).toEqual([]);
  return messages
    .filter((message) => message.ruleId === "beekeeping/imports")
    .map((message) => message.messageId);
}

const internal = (...names: string[]) =>
  names.map((name) => `@beekeeping/${name}`);
const apps = internal("web", "worker");
const dbDrivers = ["drizzle-orm", "pg", "pg-boss", "postgres"];
const framework = ["next", "react", "react-dom"];

// The policy, written out here rather than read from eslint.config.js, so a
// change to either one without the other fails this test.
const policy = [
  {
    folder: "packages/services",
    refuse: [
      ...internal("actions", "db", "mcp", "ui", "testing"),
      ...apps,
      ...dbDrivers,
      "better-auth",
      ...framework,
    ],
  },
  {
    folder: "packages/db",
    refuse: [
      ...internal("actions", "mcp", "ui", "testing"),
      ...apps,
      ...framework,
    ],
  },
  {
    folder: "packages/actions",
    refuse: [...internal("mcp", "ui", "testing"), ...apps, ...framework],
  },
  {
    folder: "packages/mcp",
    refuse: [
      ...internal("db", "ui", "testing"),
      ...apps,
      ...dbDrivers,
      ...framework,
    ],
  },
  {
    folder: "packages/ui",
    refuse: [
      ...internal("actions", "db", "mcp", "testing"),
      ...apps,
      ...dbDrivers,
    ],
  },
  { folder: "packages/testing", refuse: apps },
  { folder: "apps/web", refuse: internal("worker", "testing") },
  { folder: "apps/worker", refuse: internal("web", "testing") },
];

// Every module the policy names, subpaths of some, and look-alikes that no
// layer refuses.
const modules = [
  ...internal(
    "actions",
    "db",
    "mcp",
    "services",
    "testing",
    "ui",
    "web",
    "worker",
  ),
  ...dbDrivers,
  "better-auth",
  ...framework,
  "drizzle-orm/pg-core",
  "better-auth/plugins",
  "next/headers",
  "react/jsx-runtime",
  "node:crypto",
  "zod",
  "pg-format",
  "nextjs-toploader",
];

function isRefused(refuse: string[], module: string) {
  return refuse.some(
    (name) => module === name || module.startsWith(`${name}/`),
  );
}

const cases = policy.flatMap(({ folder, refuse }) =>
  modules.flatMap((module) => [
    {
      file: `${folder}/src/example.ts`,
      module,
      refused: isRefused(refuse, module),
    },
    {
      file: `${folder}/src/example.test.ts`,
      module,
      refused: module !== "@beekeeping/testing" && isRefused(refuse, module),
    },
  ]),
);

describe("layer boundaries", () => {
  it("has a policy for every workspace package", () => {
    const packages = ["apps", "packages"].flatMap((group) =>
      readdirSync(join(root, group), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => `${group}/${entry.name}`),
    );
    expect(policy.map(({ folder }) => folder).sort()).toEqual(packages.sort());
  });

  it.each(cases.filter(({ refused }) => refused))(
    "$file may not import $module",
    async ({ file, module }) => {
      expect(await importErrors(file, `import "${module}";\n`)).toEqual([
        "refused",
      ]);
    },
  );

  it.each(cases.filter(({ refused }) => !refused))(
    "$file may import $module",
    async ({ file, module }) => {
      expect(await importErrors(file, `import "${module}";\n`)).toEqual([]);
    },
  );
});

describe("every way of naming a module", () => {
  it.each([
    'import { db } from "@beekeeping/db";',
    'import type { Db } from "@beekeeping/db";',
    'export { db } from "@beekeeping/db";',
    'export * from "@beekeeping/db";',
    'const db = await import("@beekeeping/db");',
    "const db = await import(`@beekeeping/db`);",
    'const pg = require("pg");',
    'type Db = import("@beekeeping/db").Db;',
  ])("a service may not use %s", async (code) => {
    expect(
      await importErrors("packages/services/src/example.ts", code),
    ).toEqual(["refused"]);
  });

  it.each([
    "example.mts",
    "example.cts",
    "example.js",
    "example.mjs",
    "example.tsx",
  ])("a service's %s file may not import the db package", async (name) => {
    expect(
      await importErrors(
        `packages/services/src/${name}`,
        'import "@beekeeping/db";\n',
      ),
    ).toEqual(["refused"]);
  });
});

describe("relative imports", () => {
  it.each([
    ["packages/services/src/example.ts", 'import "../../db/src/index.ts";'],
    [
      "packages/services/src/example.ts",
      'export * from "../../db/src/index.ts";',
    ],
    [
      "packages/services/src/example.ts",
      'await import("../../actions/src/index.ts");',
    ],
    [
      "packages/services/src/example.ts",
      'import "../../../apps/web/src/app/page.tsx";',
    ],
    [
      "packages/actions/src/shared/example.ts",
      'import "../../../services/src/result.ts";',
    ],
    [
      "apps/web/src/app/example.tsx",
      'import "../../../../packages/db/src/index.ts";',
    ],
    ["tests/example.test.ts", 'import "../packages/services/src/result.ts";'],
  ])("%s may not reach into another package with %s", async (file, code) => {
    expect(await importErrors(file, code)).toEqual(["crossPackage"]);
  });

  it.each([
    ["packages/services/src/example.ts", "./result.ts"],
    ["packages/services/src/money/example.ts", "../result.ts"],
    ["packages/services/test/example.ts", "../src/result.ts"],
    ["tests/example.test.ts", "./helpers.ts"],
  ])("%s may import %s from its own package", async (file, module) => {
    expect(await importErrors(file, `import "${module}";\n`)).toEqual([]);
  });

  it("a TypeScript file names .mts and .cts files too", async () => {
    const file = "packages/services/src/example.ts";
    expect(await importErrors(file, 'import "./money.mjs";')).toEqual([
      "relativeJs",
    ]);
    expect(await importErrors(file, 'import "./money.cjs";')).toEqual([
      "relativeJs",
    ]);
  });

  it("a JavaScript file may import a real JavaScript file", async () => {
    expect(
      await importErrors("scripts/tool.mjs", 'import "./helper.js";'),
    ).toEqual([]);
  });

  it.each([
    "packages/services/src/example.ts",
    "packages/actions/src/shared/example.ts",
    "apps/web/src/app/example.tsx",
    "tests/example.test.ts",
  ])("%s names the .ts file, not .js", async (file) => {
    expect(await importErrors(file, 'import "./money.js";')).toEqual([
      "relativeJs",
    ]);
    expect(await importErrors(file, 'import "../money.js";')).toEqual([
      "relativeJs",
    ]);
  });
});
