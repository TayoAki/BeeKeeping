// @ts-check
import path from "node:path";

import js from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";
import prettier from "eslint-config-prettier/flat";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

const dbDrivers = ["drizzle-orm", "pg", "pg-boss", "postgres"];
const framework = ["next", "react", "react-dom"];

/**
 * Layer boundaries from the code-structure skill. Each layer lists the modules
 * its files may not import, along with anything under them, such as
 * next/headers. Tests may also import @beekeeping/testing.
 * tests/layer-boundaries.test.ts checks every layer against its own copy of
 * this policy.
 */
const layers = [
  {
    folder: "packages/services",
    refuse: [
      ...internal("actions", "db", "mcp", "ui", "testing", "web", "worker"),
      ...dbDrivers,
      "better-auth",
      ...framework,
    ],
    message:
      "Services take everything as parameters. They never read the session or our tables and never call actions. Move this code into an action.",
  },
  {
    folder: "packages/db",
    refuse: [
      ...internal("actions", "mcp", "ui", "testing", "web", "worker"),
      ...framework,
    ],
    message:
      "The db package sits below the actions. It never imports actions, the MCP server, UI or an app.",
  },
  {
    folder: "packages/actions",
    refuse: [
      ...internal("mcp", "ui", "testing", "web", "worker"),
      ...framework,
    ],
    message:
      "Actions don't know which adapter called them. The web app, the worker and the MCP server build the action context and call actions, never the other way round.",
  },
  {
    folder: "packages/mcp",
    refuse: [
      ...internal("db", "ui", "testing", "web", "worker"),
      ...dbDrivers,
      ...framework,
    ],
    message:
      "MCP tools come from the action registry. Call an action instead of reaching into the database, the UI or an app.",
  },
  {
    folder: "packages/ui",
    refuse: [
      ...internal("actions", "db", "mcp", "testing", "web", "worker"),
      ...dbDrivers,
    ],
    message:
      "Shared components render what they are given. They don't load data, call actions or import an app.",
  },
  {
    folder: "packages/testing",
    refuse: internal("web", "worker"),
    message: "Test helpers never import an app.",
  },
  {
    // The web app may import db, because Better Auth's database adapter
    // needs it.
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

const repoRoot = import.meta.dirname;

/**
 * The workspace package a file belongs to, such as packages/services, or
 * undefined for files outside apps/ and packages/.
 * @param {string} file
 */
function packageOf(file) {
  const [group, name] = path.relative(repoRoot, file).split(path.sep);
  return (group === "apps" || group === "packages") && name
    ? `${group}/${name}`
    : undefined;
}

/**
 * Checks every way a file names another module: import and export
 * declarations, import(), require() and import("...") types.
 * - A module on the layer's refuse list is an error.
 * - A relative path into another package is an error, so a layer can't be
 *   crossed by path instead of by name.
 * - A relative path that ends in .js is an error. TypeScript maps it to the
 *   .ts file, but plain Node can't.
 * @type {import("eslint").Rule.RuleModule}
 */
const importsRule = {
  meta: {
    type: "problem",
    docs: { description: "Keep imports inside BeeKeeping's layers." },
    schema: [
      {
        type: "object",
        properties: {
          refuse: { type: "array", items: { type: "string" } },
          message: { type: "string" },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      refused: "Don't import {{module}} here. {{message}}",
      crossPackage:
        "Import another package by its name, such as @beekeeping/services, so the layer rules can check it.",
      relativeJs:
        "Import the .ts file by its real name, as in ./money.ts. Plain Node can't run a .js path to a .ts file.",
    },
  },
  create(context) {
    /** @type {{ refuse?: string[], message?: string }} */
    const options = context.options[0] ?? {};
    const refuse = options.refuse ?? [];
    const from = packageOf(context.filename);

    /**
     * @param {import("estree").Node} node
     * @param {unknown} specifier
     */
    function check(node, specifier) {
      if (typeof specifier !== "string") return;
      if (specifier.startsWith(".")) {
        if (specifier.endsWith(".js")) {
          context.report({ node, messageId: "relativeJs" });
        }
        const target = path.resolve(path.dirname(context.filename), specifier);
        if (packageOf(target) !== from) {
          context.report({ node, messageId: "crossPackage" });
        }
        return;
      }
      const refused = refuse.some(
        (name) => specifier === name || specifier.startsWith(`${name}/`),
      );
      if (refused) {
        context.report({
          node,
          messageId: "refused",
          data: { module: specifier, message: options.message ?? "" },
        });
      }
    }

    /**
     * The text of a string literal, or of a template literal with no
     * placeholders.
     * @param {import("estree").Node | null | undefined} node
     */
    function literalText(node) {
      if (node?.type === "Literal") return node.value;
      if (node?.type === "TemplateLiteral" && node.expressions.length === 0) {
        return node.quasis[0]?.value.cooked;
      }
      return undefined;
    }

    return {
      ImportDeclaration: (node) => check(node.source, node.source.value),
      ExportAllDeclaration: (node) => check(node.source, node.source.value),
      ExportNamedDeclaration: (node) => {
        if (node.source) check(node.source, node.source.value);
      },
      ImportExpression: (node) => check(node.source, literalText(node.source)),
      CallExpression: (node) => {
        const [first] = node.arguments;
        if (
          node.callee.type === "Identifier" &&
          node.callee.name === "require" &&
          first &&
          first.type !== "SpreadElement"
        ) {
          check(first, literalText(first));
        }
      },
      // typescript-eslint's node for types written as import("module").Name.
      /** @param {any} node */
      TSImportType: (node) => check(node, node.source?.value),
    };
  },
};

const scriptFiles = "*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}";

const layerConfigs = layers.flatMap((layer) => [
  {
    name: `beekeeping/layers/${layer.folder}`,
    files: [`${layer.folder}/**/${scriptFiles}`],
    rules: {
      "beekeeping/imports": [
        "error",
        { refuse: layer.refuse, message: layer.message },
      ],
    },
  },
  {
    name: `beekeeping/layers/${layer.folder}/tests`,
    files: [`${layer.folder}/**/*.test.{ts,tsx}`],
    rules: {
      "beekeeping/imports": [
        "error",
        {
          refuse: layer.refuse.filter((name) => name !== "@beekeeping/testing"),
          message: layer.message,
        },
      ],
    },
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
        tsconfigRootDir: repoRoot,
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
    plugins: { beekeeping: { rules: { imports: importsRule } } },
    rules: { "beekeeping/imports": "error" },
  },
  {
    name: "beekeeping/javascript",
    files: ["**/*.{js,mjs,cjs}"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
  {
    name: "beekeeping/jsx-a11y",
    files: ["**/*.tsx"],
    extends: [jsxA11y.flatConfigs.recommended],
  },
  {
    // Custom hooks often live in .ts files, so the hook rules cover them too.
    name: "beekeeping/react-hooks",
    files: ["**/*.tsx", "apps/web/**/*.ts", "packages/ui/**/*.ts"],
    extends: [reactHooks.configs.flat.recommended],
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
