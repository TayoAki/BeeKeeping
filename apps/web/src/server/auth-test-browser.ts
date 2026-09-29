// Test helpers for sign-in: a browser that keeps cookies and calls Better
// Auth's handler directly, the email outbox, and authenticator codes.
// Only tests import this file.

import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDatabase } from "@beekeeping/db";
import { email } from "@beekeeping/services";

import { createAuth, handleAuthRequest, type Auth } from "./auth.ts";

export const baseUrl = "http://localhost:3000";
/** The secret the test Better Auth signs sessions and links with. */
export const testSecret = "test-secret-that-is-at-least-32-characters-long";

export type Reply = {
  readonly status: number;
  readonly body: Record<string, unknown> | null;
  readonly location: string | null;
};

function parseBody(text: string): Record<string, unknown> | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * One person's browser: it sends and keeps their session cookie, and comes
 * from one address, as Railway's proxy reports it in X-Real-IP.
 */
export class Browser {
  private readonly cookies = new Map<string, string>();
  private readonly auth: Auth;
  private readonly address: string;

  constructor(auth: Auth, address: string) {
    this.auth = auth;
    this.address = address;
  }

  async request(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<Reply> {
    const cookie = [...this.cookies]
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
    const response = await handleAuthRequest(
      this.auth,
      new Request(`${baseUrl}/api/auth${path}`, {
        method,
        headers: {
          "content-type": "application/json",
          origin: baseUrl,
          "x-real-ip": this.address,
          ...(cookie ? { cookie } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: "manual",
      }),
    );
    this.keep(response.headers);
    return {
      status: response.status,
      body: parseBody(await response.text()),
      location: response.headers.get("location"),
    };
  }

  /** Keeps the cookies an answer sets, and forgets the ones it clears. */
  private keep(headers: Headers) {
    for (const header of headers.getSetCookie()) {
      const [pair = ""] = header.split(";");
      const separator = pair.indexOf("=");
      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1);
      if (value === "" || /max-age=0/i.test(header)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  /**
   * Opens a confirmation link and enters a password, as the confirmation
   * page does. Answers undefined when the address is confirmed, or the
   * refusal's code, such as WRONG_PASSWORD, or its status.
   */
  async confirm(link: string, password: string): Promise<string | undefined> {
    const token = new URL(link).searchParams.get("token") ?? "";
    const reply = await this.post("/confirm-email", { token, password });
    if (reply.status === 200) return undefined;
    const code = reply.body?.code;
    return typeof code === "string" ? code : String(reply.status);
  }

  post(path: string, body: unknown = {}): Promise<Reply> {
    return this.request("POST", path, body);
  }

  get(path: string): Promise<Reply> {
    return this.request("GET", path);
  }

  /** Follows a link from an email that points into /api/auth. */
  visit(link: string): Promise<Reply> {
    const url = new URL(link);
    return this.get(`${url.pathname.replace(/^\/api\/auth/, "")}${url.search}`);
  }

  /** The session token in this browser's cookie, without its signature. */
  sessionToken(): string {
    const [, value = ""] =
      [...this.cookies].find(([name]) => name.endsWith("session_token")) ?? [];
    return decodeURIComponent(value).split(".")[0] ?? "";
  }

  /** The signed-in user's id, or null when there is no session. */
  async userId(): Promise<string | null> {
    const reply = await this.get("/get-session");
    const user = reply.body?.user as { id?: string } | undefined;
    return user?.id ?? null;
  }
}

export type TestAuth = {
  readonly auth: Auth;
  readonly outbox: string;
  /** A new browser, from 203.0.113.1 unless given another address. */
  browser(address?: string): Browser;
  /**
   * Closes the pool this Better Auth uses and removes its outbox. Call it
   * before dropping the database.
   */
  close(): Promise<void>;
  /** The newest email to address. */
  newestEmail(address: string): Promise<email.OutboxEntry>;
  /** The first link in the newest email to address. */
  linkFor(address: string): Promise<string>;
};

export function createTestAuth(
  databaseUrl: string,
  options: { transport?: email.EmailTransport; rateLimit?: boolean } = {},
): TestAuth {
  const outbox = mkdtempSync(join(tmpdir(), "beekeeping-outbox-"));
  const handle = openDatabase(databaseUrl, { max: 5 });
  const auth = createAuth({
    db: handle.db,
    secret: testSecret,
    baseUrl,
    transport: options.transport ?? {
      kind: "outbox",
      dir: outbox,
      from: "BeeKeeping <test@beekeeping.test>",
    },
    rateLimit: options.rateLimit ?? false,
  });
  async function newestEmail(address: string) {
    const messages = (await email.readOutbox(outbox)).filter(
      (message) => message.to === address,
    );
    const newest = messages.at(-1);
    if (!newest) throw new Error(`No email to ${address}`);
    return newest;
  }
  return {
    auth,
    outbox,
    browser: (address = "203.0.113.1") => new Browser(auth, address),
    close: async () => {
      await handle.close();
      rmSync(outbox, { recursive: true, force: true });
    },
    newestEmail,
    async linkFor(address) {
      const link = (await newestEmail(address)).text.match(
        /https?:\/\/\S+/,
      )?.[0];
      if (!link) throw new Error(`No email with a link to ${address}`);
      return link;
    },
  };
}

function base32Decode(text: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const character of text.replace(/=+$/, "").toUpperCase()) {
    bits += alphabet.indexOf(character).toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
}

/** The six-digit code an authenticator app shows now, per RFC 6238. */
export function authenticatorCode(secret: string, now = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30_000)));
  const digest = createHmac("sha1", base32Decode(secret))
    .update(counter)
    .digest();
  const offset = (digest.at(-1) ?? 0) & 0xf;
  const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, "0");
}
