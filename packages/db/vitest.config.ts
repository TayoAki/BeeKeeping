import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "@beekeeping/db",
    globalSetup: ["./src/testing/global-setup.ts"],
  },
});
