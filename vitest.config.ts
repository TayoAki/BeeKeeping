import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // A test focused with .only fails the run, so CI never passes on a subset.
    allowOnly: false,
    projects: [
      "apps/*",
      "packages/*",
      {
        test: {
          name: "repo",
          include: ["tests/**/*.test.ts"],
        },
      },
    ],
  },
});
