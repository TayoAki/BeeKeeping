// The email service sends one message through the transport it is given.
// Resend delivers real mail. The outbox writes each message to a file, for
// development and tests, where no mail may leave the machine.

import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { fail, ok, type Result } from "../result.ts";

export type EmailMessage = {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
};

export type EmailTransport =
  | { readonly kind: "resend"; readonly apiKey: string; readonly from: string }
  | { readonly kind: "outbox"; readonly dir: string; readonly from: string };

export type SendFailure = "rejected" | "unreachable";

/** A message the outbox wrote, as tests and evidence scripts read it back. */
export type OutboxEntry = EmailMessage & {
  readonly id: string;
  readonly from: string;
  readonly sentAt: string;
};

/**
 * Sends one message. A failure carries a reason code only: never the API key,
 * the address or the body, which may hold a sign-in link. Resend gets
 * timeoutMs to answer, so a hung connection can't hold a sign-up open.
 */
export async function send(
  transport: EmailTransport,
  message: EmailMessage,
  {
    fetch = globalThis.fetch,
    timeoutMs = 10_000,
  }: { fetch?: typeof globalThis.fetch; timeoutMs?: number } = {},
): Promise<Result<{ id: string }, SendFailure>> {
  if (transport.kind === "outbox") {
    const entry: OutboxEntry = {
      id: randomUUID(),
      from: transport.from,
      sentAt: new Date().toISOString(),
      ...message,
    };
    // Names sort by time, so readers see messages in the order they were sent.
    const name = `${entry.sentAt.replaceAll(":", "-")}-${entry.id}.json`;
    try {
      await mkdir(transport.dir, { recursive: true });
      await writeFile(
        join(transport.dir, name),
        JSON.stringify(entry, null, 2),
      );
    } catch {
      return fail("unreachable");
    }
    return ok({ id: entry.id });
  }

  let response: Response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${transport.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: transport.from, ...message }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return fail("unreachable");
  }
  if (!response.ok) {
    return fail(response.status >= 500 ? "unreachable" : "rejected");
  }
  let body: { id?: unknown };
  try {
    body = (await response.json()) as { id?: unknown };
  } catch {
    return fail("rejected");
  }
  return typeof body.id === "string" ? ok({ id: body.id }) : fail("rejected");
}

/** Every message in an outbox folder, oldest first. */
export async function readOutbox(dir: string): Promise<OutboxEntry[]> {
  let names: string[];
  try {
    names = (await readdir(dir)).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }
  const entries = await Promise.all(
    names
      .sort()
      .map(
        async (name) =>
          JSON.parse(await readFile(join(dir, name), "utf8")) as OutboxEntry,
      ),
  );
  return entries;
}
