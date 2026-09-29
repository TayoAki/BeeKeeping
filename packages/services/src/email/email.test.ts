import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it, vi } from "vitest";

import { email } from "../index.ts";

// Each test's folders, removed when the file's tests end.
const folders: string[] = [];
function folder(): string {
  const dir = mkdtempSync(join(tmpdir(), "beekeeping-outbox-"));
  folders.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of folders) rmSync(dir, { recursive: true, force: true });
});

const message = {
  to: "owner@honeycomb-demo.test",
  subject: "Sign in to BeeKeeping",
  text: "Open https://example.test/link to sign in.",
};

describe("the outbox transport", () => {
  it("writes each message to a file and reads them back in order", async () => {
    const dir = folder();
    const transport = {
      kind: "outbox",
      dir,
      from: "BeeKeeping <test@beekeeping.test>",
    } as const;

    const first = await email.send(transport, message);
    const second = await email.send(transport, {
      ...message,
      subject: "Second",
    });

    expect(first.ok && second.ok).toBe(true);
    const entries = await email.readOutbox(dir);
    expect(entries.map(({ subject }) => subject)).toEqual([
      "Sign in to BeeKeeping",
      "Second",
    ]);
    expect(entries[0]).toMatchObject({ ...message, from: transport.from });
  });

  it("reads an outbox that doesn't exist yet as empty", async () => {
    expect(await email.readOutbox("/tmp/no-such-outbox-folder")).toEqual([]);
  });
});

describe("the Resend transport", () => {
  const transport = {
    kind: "resend",
    apiKey: "re_test_key",
    from: "BeeKeeping <mail@beekeeping.test>",
  } as const;

  it("posts the message with the key and returns Resend's id", async () => {
    const fetch = vi.fn(() =>
      Promise.resolve(Response.json({ id: "email_123" })),
    );
    expect(await email.send(transport, message, { fetch })).toEqual({
      ok: true,
      id: "email_123",
    });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(new Headers(init.headers).get("authorization")).toBe(
      "Bearer re_test_key",
    );
    expect(JSON.parse(init.body as string)).toEqual({
      from: transport.from,
      ...message,
    });
  });

  it.each([
    [422, "rejected"],
    [401, "rejected"],
    [503, "unreachable"],
  ] as const)(
    "reports a %i answer as %s, with no details",
    async (status, reason) => {
      const fetch = () => Promise.resolve(new Response("nope", { status }));
      expect(await email.send(transport, message, { fetch })).toEqual({
        ok: false,
        reason,
      });
    },
  );

  it("reports a network failure as unreachable", async () => {
    const fetch = () => Promise.reject(new TypeError("fetch failed"));
    expect(await email.send(transport, message, { fetch })).toEqual({
      ok: false,
      reason: "unreachable",
    });
  });
});

const resend = {
  kind: "resend",
  apiKey: "re_test_not_a_real_key",
  from: "BeeKeeping <test@beekeeping.test>",
} as const;

describe("send, when delivery breaks", () => {
  it("answers unreachable when the outbox can't be written", async () => {
    // A file where the folder should be.
    const dir = folder();
    const blocked = join(dir, "blocked");
    writeFileSync(blocked, "");
    expect(
      await email.send(
        {
          kind: "outbox",
          dir: blocked,
          from: "BeeKeeping <test@beekeeping.test>",
        },
        { to: "avery@honeycomb-demo.test", subject: "Hi", text: "Hi" },
      ),
    ).toEqual({ ok: false, reason: "unreachable" });
  });

  it("answers rejected when Resend's answer isn't JSON", async () => {
    const fetch = () =>
      Promise.resolve(new Response("<html>", { status: 200 }));
    expect(await email.send(resend, message, { fetch })).toEqual({
      ok: false,
      reason: "rejected",
    });
  });

  it("gives up on a Resend that never answers", async () => {
    const fetch = (_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new Error("aborted")),
        );
      });
    const started = performance.now();
    expect(await email.send(resend, message, { fetch, timeoutMs: 50 })).toEqual(
      { ok: false, reason: "unreachable" },
    );
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});
