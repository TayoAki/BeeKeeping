// API tokens: long random strings that headless agents send in place of a
// sign-in. A token is shown once, when it's made, and only its SHA-256 hash
// is kept, so a copy of the database can't act as anyone. 32 random bytes
// can't be guessed, so a plain hash is enough and no salt is needed.
import { createHash, randomBytes } from "node:crypto";

import { fail, ok, type Result } from "../result.ts";

/** Every token starts with this, so a leaked one is easy to spot. */
const marker = "bk_";

/** The marker and 32 random bytes in base64url: 43 characters. */
const shape = /^bk_[A-Za-z0-9_-]{43}$/;

/** How much of a token lists may show, so a person can tell tokens apart. */
const shownLength = 10;

export type NewApiToken = {
  /** The token itself. Show it once, then forget it. */
  readonly token: string;
  /** What to store: the token's SHA-256, in hex. */
  readonly hash: string;
  /** The token's first characters, safe to list. */
  readonly prefix: string;
};

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** A new random token, its hash and its prefix. */
export function newApiToken(): NewApiToken {
  const token = `${marker}${randomBytes(32).toString("base64url")}`;
  return { token, hash: sha256(token), prefix: token.slice(0, shownLength) };
}

/**
 * The hash to look a presented token up by. Text that can't be a token,
 * such as a password or a token cut short, fails without being hashed.
 */
export function apiTokenHash(
  presented: string,
): Result<{ hash: string }, "malformed"> {
  return shape.test(presented)
    ? ok({ hash: sha256(presented) })
    : fail("malformed");
}
