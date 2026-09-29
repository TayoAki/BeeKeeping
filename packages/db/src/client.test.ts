import { describe, expect, it } from "vitest";

import { openDatabase } from "./client.ts";

describe("openDatabase's URL", () => {
  it("takes pg's socket form, with a user and no host", async () => {
    const { pool, close } = openDatabase(
      "postgres://beekeeping_web@/books?host=/var/run/postgresql",
      { onError: () => {} },
    );
    expect(pool.options.host).toBe("/var/run/postgresql");
    expect(pool.options.database).toBe("books");
    await close();
  });

  it.each([
    ["ssl=no-verify", { rejectUnauthorized: false }],
    ["sslmode=no-verify", { rejectUnauthorized: false }],
    ["sslmode=disable", false],
  ])("keeps TLS as pg reads it, for %s", async (setting, ssl) => {
    const { pool, close } = openDatabase(
      `postgres://beekeeping_web@db.example.test/books?${setting}`,
      { onError: () => {} },
    );
    expect(pool.options.ssl).toEqual(ssl);
    await close();
  });

  it("refuses any other ssl setting, rather than drop TLS", () => {
    expect(() =>
      openDatabase(
        "postgres://beekeeping_web:SecretPass9@db.example.test/books?ssl=require",
      ),
    ).toThrow(
      "The database URL's ssl setting isn't one BeeKeeping reads. Use sslmode, such as sslmode=verify-full.",
    );
  });

  it.each([
    // A password with a raw slash or hash, as generated passwords often
    // have, needs percent-encoding in a URL.
    "postgres://beekeeping_web:Zx9/SecretPass9@127.0.0.1/books",
    "postgres://beekeeping_web:SecretPass9#x@127.0.0.1/books",
    "postgres://beekeeping_web:SecretPass9@[broken/books",
  ])("keeps the password out of the error for %s", (url) => {
    let caught: unknown;
    try {
      openDatabase(url);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    const everything = JSON.stringify(
      caught,
      Object.getOwnPropertyNames(caught),
    );
    expect(everything).not.toContain("SecretPass9");
  });
});
