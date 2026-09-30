import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { apiTokenHash, newApiToken } from "./index.ts";

describe("API tokens", () => {
  it("are 32 random bytes behind bk_, kept as their SHA-256", () => {
    const made = newApiToken();
    expect(made.token).toMatch(/^bk_[A-Za-z0-9_-]{43}$/);
    expect(made.hash).toBe(
      createHash("sha256").update(made.token).digest("hex"),
    );
    expect(made.prefix).toBe(made.token.slice(0, 10));
    expect(newApiToken().token).not.toBe(made.token);
  });

  it("look up by the same hash they were stored as", () => {
    const made = newApiToken();
    expect(apiTokenHash(made.token)).toEqual({ ok: true, hash: made.hash });
  });

  it("refuse text that can't be a token, without hashing it", () => {
    const made = newApiToken();
    for (const presented of [
      "",
      "correct horse battery staple",
      made.token.slice(0, -1),
      `${made.token}x`,
      made.token.replace("bk_", "BK_"),
      ` ${made.token}`,
      `${made.token.slice(0, -1)}=`,
    ]) {
      expect(apiTokenHash(presented)).toEqual({
        ok: false,
        reason: "malformed",
      });
    }
  });
});
