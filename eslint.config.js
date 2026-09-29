// @ts-check
import js from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";
import prettier from "eslint-config-prettier/flat";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * Layer boundaries from the code-structure skill. Each layer lists the modules
 * its source files may not import. Tests may also import @beekeeping/testing.
 * tests/layer-boundaries.test.ts proves each boundary holds.
 */
const layers = [
  {
    folder: "packages/services",
    refuse: [
      ...internal("actions", "db", "mcp", "ui", "testing", "web", "worker"),
      ...["drizzle-orm", "pg", "pg-boss", "postgres", "better-auth"],
      ...["next", "react", "react-dom"],
    ],
    message:
      "Services take everything as parameters. They never read the session or our tables and never call actions. Move this code into an action.",
  },
  {
    folder: "packages/db",
    refuse: [
      ...internal("actions", "mcp", "ui", "testing", "web", "worker"),
      ...["next", "react", "react-dom"],
    ],
    message:
      "The db package sits below the actions. It never imports actions, the MCP server, UI or an app.",
  },
  {
    folder: "packages/actions",
    refuse: [
      ...internal("mcp", "ui", "testing", "web", "worker"),
      ...["next", "react", "react-dom"],
    ],
    message:
      "Actions don't know which adapter called them. The web app, the worker and the MCP server build the action context and call actions, never the other way round.",
  },
  {
    folder: "packages/mcp",
    refuse: [
      ...internal("db", "ui", "testing", "web", "worker"),
      ...["next", "react", "react-dom"],
    ],
    message:
      "MCP tools come from the action registry. Call an action instead of reaching into the database, the UI or an app.",
  },
  {
    folder: "packages/ui",
    refuse: internal("actions", "db", "mcp", "testing", "web", "worker"),
    message:
      "Shared components render what they are given. They don't load data, call actions or import an app.",
  },
  {
    folder: "packages/testing",
    refuse: internal("web", "worker"),
    message: "Test helpers never import an app.",
  },
  {
    folder: "apps/web",
    refuse: internal("worker", "testing"),
    message:
      "Apps never import each other, and only tests import @beekeeping/testing.",
  },
  {
    folder: "apps/worker",
    refuse: internal("web", "testing"),
    message:
      "Apps never import each other, and only tests import @beekeeping/testing.",
  },
];

/** @param {...string} names */
function internal(...names) {
  return names.map((name) => `@beekeeping/${name}`);
}

/**
 * TypeScript accepts "./money.js" for money.ts, but plain Node can't run it.
 * Relative imports name the real file, so the worker needs no build step.
 */
const relativeJsImport = {
  regex: "^\\.{1,2}/.*\\.js$",
  message: "Import the .ts file by its real name, as in ./money.ts.",
};

/**
 * Options for no-restricted-imports. A later config replaces the rule's
 * options instead of merging them, so every config builds them here: the
 * layer's refused modules and anything under them, such as next/headers,
 * plus relative imports that end in .js.
 * @param {{ refuse: string[], message: string }} [layer]
 */
function restrictedImports(layer) {
  const patterns = [relativeJsImport];
  if (layer) {
    const escaped = layer.refuse.map((name) =>
      name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    );
    patterns.unshift({
      regex: `^(${escaped.join("|")})(/|$)`,
      message: layer.message,
    });
  }
  return { "no-restricted-imports": ["error", { patterns }] };
}

const layerConfigs = layers.flatMap((layer) => [
  {
    name: `beekeeping/layers/${layer.folder}`,
    files: [`${layer.folder}/**/*.{ts,tsx}`],
    rules: restrictedImports(layer),
  },
  {
    name: `beekeeping/layers/${layer.folder}/tests`,
    files: [`${layer.folder}/**/*.test.{ts,tsx}`],
    rules: restrictedImports({
      ...layer,
      refuse: layer.refuse.filter((name) => name !== "@beekeeping/testing"),
    }),
  },
]);

export default defineConfig([
  globalIgnores([
    ".artifacts/",
    ".claude/",
    "research/",
    "**/.next/",
    "**/next-env.d.ts",
    "**/coverage/",
    "**/dist/",
  ]),
  {
    name: "beekeeping/linter-options",
    linterOptions: { reportUnusedDisableDirectives: "error" },
  },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    name: "beekeeping/typescript",
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      eqeqeq: ["error", "always"],
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    name: "beekeeping/imports",
    files: ["**/*.{ts,tsx}"],
    rules: restrictedImports(),
  },
  {
    name: "beekeeping/javascript",
    files: ["**/*.{js,mjs,cjs}"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
  {
    name: "beekeeping/react",
    files: ["**/*.tsx"],
    extends: [
      jsxA11y.flatConfigs.recommended,
      reactHooks.configs.flat.recommended,
    ],
  },
  {
    name: "beekeeping/next",
    files: ["apps/web/**/*.{ts,tsx}"],
    extends: [
      nextPlugin.configs.recommended,
      nextPlugin.configs["core-web-vitals"],
    ],
    rules: {
      // The rule looks for a pages/ folder. BeeKeeping uses the App Router only.
      "@next/next/no-html-link-for-pages": "off",
    },
  },
  ...layerConfigs,
  prettier,
]);
