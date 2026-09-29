import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineConfig, devices } from "@playwright/test";

// Each run takes E2E_PORT for next dev, the port after it for serve.ts's
// readiness answer, and one outbox. The tests read sign-up emails from the
// outbox, so they and the server agree on where it is.
const port = Number(process.env.E2E_PORT ?? 3190);
const outbox = join(tmpdir(), `beekeeping-e2e-outbox-${port}`);
process.env.E2E_OUTBOX = outbox;

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.e2e.ts",
  forbidOnly: true,
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  // Traces and screenshots of failures stay out of the repo.
  outputDir: join(tmpdir(), `beekeeping-e2e-results-${port}`),
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://localhost:${port}`,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node e2e/serve.ts",
    // serve.ts answers here once every page has compiled.
    url: `http://127.0.0.1:${port + 1}/`,
    timeout: 180_000,
    reuseExistingServer: false,
    gracefulShutdown: { signal: "SIGTERM", timeout: 15_000 },
    env: { E2E_PORT: String(port), E2E_OUTBOX: outbox },
  },
});
