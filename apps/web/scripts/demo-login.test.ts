import {
  chmodSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The module reads the folder when it loads, so the test picks it first.
const folder = mkdtempSync(join(tmpdir(), "beekeeping-demo-"));
vi.stubEnv("BEEKEEPING_DEMO_DIR", join(folder, "demo"));
const {
  demoPassword,
  localDemo,
  localDemoFile,
  localDemoOutbox,
  readLocalDemo,
} = await import("./demo-login.ts");

beforeAll(() => {
  vi.stubEnv("DEMO_PASSWORD", "");
});
afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(folder, { recursive: true, force: true });
});

describe("the local demo's login", () => {
  it("doesn't exist before dev:demo first runs", () => {
    expect(readLocalDemo()).toBeUndefined();
    expect(demoPassword()).toBeUndefined();
  });

  it("is made once, readable by its owner only, and kept", () => {
    const made = localDemo();
    expect(made.password.length).toBeGreaterThanOrEqual(12);
    expect(made.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(statSync(localDemoFile()).mode & 0o777).toBe(0o600);
    expect(statSync(join(folder, "demo")).mode & 0o777).toBe(0o700);
    expect(localDemo()).toEqual(made);
    expect(demoPassword()).toEqual({
      password: made.password,
      from: localDemoFile(),
    });
    expect(dirname(localDemoOutbox())).toBe(dirname(localDemoFile()));
  });

  it("replaces a broken file with one only its owner can read", () => {
    writeFileSync(localDemoFile(), "not a login");
    chmodSync(localDemoFile(), 0o644);
    const made = localDemo();
    expect(statSync(localDemoFile()).mode & 0o777).toBe(0o600);
    expect(readLocalDemo()).toEqual(made);
  });

  it("gives way to DEMO_PASSWORD", () => {
    vi.stubEnv("DEMO_PASSWORD", "the staging demo password");
    expect(demoPassword()).toEqual({
      password: "the staging demo password",
      from: "DEMO_PASSWORD",
    });
    vi.stubEnv("DEMO_PASSWORD", "");
  });
});
