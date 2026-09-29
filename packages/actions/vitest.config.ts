import { fileURLToPath } from "node:url";

import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "@beekeeping/actions",
    globalSetup: [
      fileURLToPath(import.meta.resolve("@beekeeping/db/testing/global-setup")),
    ],
  },
});
