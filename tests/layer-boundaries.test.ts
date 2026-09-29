import { ESLint } from "eslint";
import tseslint from "typescript-eslint";
import { describe, expect, it } from "vitest";

// Lints a single import as if it sat in the given file. Type information is
// off because the layer rules don't need it and the file doesn't exist.
const eslint = new ESLint({
  cwd: import.meta.dirname + "/..",
  overrideConfig: tseslint.configs.disableTypeChecked,
});

async function restrictedImportErrors(file: string, module: string) {
  const [result] = await eslint.lintText(`import "${module}";\n`, {
    filePath: file,
  });
  const messages = result?.messages ?? [];
  expect(messages.filter((message) => message.fatal)).toEqual([]);
  return messages.filter(
    (message) => message.ruleId === "no-restricted-imports",
  );
}

describe("layer boundaries", () => {
  it.each([
    ["packages/services/src/example.ts", "@beekeeping/db"],
    ["packages/services/src/example.ts", "@beekeeping/actions"],
    ["packages/services/src/example.ts", "@beekeeping/testing"],
    ["packages/services/src/example.ts", "drizzle-orm/pg-core"],
    ["packages/services/src/example.ts", "pg-boss"],
    ["packages/services/src/example.ts", "better-auth"],
    ["packages/services/src/example.ts", "next/headers"],
    ["packages/services/src/example.test.ts", "@beekeeping/db"],
    ["packages/db/src/example.ts", "@beekeeping/actions"],
    ["packages/db/src/example.ts", "@beekeeping/testing"],
    ["packages/actions/src/example.ts", "@beekeeping/mcp"],
    ["packages/actions/src/example.ts", "@beekeeping/web"],
    ["packages/actions/src/example.ts", "next/headers"],
    ["packages/actions/src/example.ts", "react"],
    ["packages/mcp/src/example.ts", "@beekeeping/db"],
    ["packages/ui/src/example.tsx", "@beekeeping/actions"],
    ["packages/ui/src/example.tsx", "@beekeeping/db"],
    ["packages/testing/src/example.ts", "@beekeeping/web"],
    ["apps/web/src/example.ts", "@beekeeping/worker"],
    ["apps/web/src/example.ts", "@beekeeping/testing"],
    ["apps/worker/src/example.ts", "@beekeeping/web"],
  ])("%s may not import %s", async (file, module) => {
    const errors = await restrictedImportErrors(file, module);
    expect(errors).toHaveLength(1);
  });

  it.each([
    ["packages/services/src/example.ts", "node:crypto"],
    ["packages/services/src/example.ts", "nextjs-like-name"],
    ["packages/services/src/example.test.ts", "@beekeeping/testing"],
    ["packages/db/src/example.ts", "@beekeeping/services"],
    ["packages/actions/src/example.ts", "@beekeeping/services"],
    ["packages/actions/src/example.ts", "@beekeeping/db"],
    ["packages/mcp/src/example.ts", "@beekeeping/actions"],
    ["packages/ui/src/example.tsx", "@beekeeping/services"],
    ["packages/testing/src/example.ts", "@beekeeping/actions"],
    ["apps/web/src/example.ts", "@beekeeping/actions"],
    ["apps/web/src/example.test.ts", "@beekeeping/testing"],
    ["apps/worker/src/example.ts", "@beekeeping/actions"],
  ])("%s may import %s", async (file, module) => {
    const errors = await restrictedImportErrors(file, module);
    expect(errors).toEqual([]);
  });
});

describe("relative imports", () => {
  it.each([
    "packages/services/src/example.ts",
    "packages/actions/src/shared/example.ts",
    "apps/web/src/app/example.tsx",
    "tests/example.test.ts",
  ])("%s names the .ts file, not .js", async (file) => {
    expect(await restrictedImportErrors(file, "../money.js")).toHaveLength(1);
    expect(await restrictedImportErrors(file, "./money.js")).toHaveLength(1);
    expect(await restrictedImportErrors(file, "./money.ts")).toEqual([]);
  });
});
