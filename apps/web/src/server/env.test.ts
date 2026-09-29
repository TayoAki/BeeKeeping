import { describe, expect, it } from "vitest";

import { readServerEnv } from "./env.ts";

const complete = {
  DATABASE_URL: "postgres://app@db.example.test/books",
  BETTER_AUTH_SECRET: "a-secret-that-is-at-least-32-characters",
  BETTER_AUTH_URL: "https://app.example.test",
};

describe("readServerEnv", () => {
  it("fills in development defaults", () => {
    expect(readServerEnv(complete)).toMatchObject({
      NODE_ENV: "development",
      BEEKEEPING_OUTBOX_DIR: "/tmp/beekeeping-outbox",
    });
  });

  it("names every missing setting", () => {
    expect(() => readServerEnv({})).toThrow(
      /DATABASE_URL[\s\S]*BETTER_AUTH_SECRET[\s\S]*BETTER_AUTH_URL/,
    );
  });

  it("never repeats a setting's value in its error", () => {
    const secret = "too-short-secret-value";
    let message = "";
    try {
      readServerEnv({ ...complete, BETTER_AUTH_SECRET: secret });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("BETTER_AUTH_SECRET");
    expect(message).not.toContain(secret);
  });

  it("needs a Resend key and a sender in production", () => {
    expect(() =>
      readServerEnv({ ...complete, NODE_ENV: "production" }),
    ).toThrow(/RESEND_API_KEY[\s\S]*EMAIL_FROM/);
    const production = readServerEnv({
      ...complete,
      NODE_ENV: "production",
      RESEND_API_KEY: "re_x",
      EMAIL_FROM: "BeeKeeping <books@honeycomb-demo.test>",
    });
    expect(production.RESEND_API_KEY).toBe("re_x");
    expect(production.EMAIL_FROM).toBe(
      "BeeKeeping <books@honeycomb-demo.test>",
    );
  });

  it("sends from a test address outside production", () => {
    expect(readServerEnv(complete).EMAIL_FROM).toBe(
      "BeeKeeping <no-reply@beekeeping.test>",
    );
  });
});
