import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createTestDatabase, type TestDatabase } from "@beekeeping/db/testing";
import { email } from "@beekeeping/services";
import { signJWT } from "better-auth/crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  authenticatorCode,
  baseUrl,
  createTestAuth,
  testSecret,
  type Browser,
  type TestAuth,
} from "./auth-test-browser.ts";
import { handleAuthRequest, logAuth } from "./auth.ts";

const password = "correct horse battery staple";
const demo = (name: string) => `${name}@honeycomb-demo.test`;

let database: TestDatabase;
let testAuth: TestAuth;

beforeAll(async () => {
  database = await createTestDatabase();
  testAuth = createTestAuth(database.appUrl);
});
afterAll(async () => {
  await testAuth.close();
  await database.drop();
});

/** Runs SQL as the database owner, who sets up rows around the app. */
async function asOwner<Row extends Record<string, unknown>>(
  text: string,
  values: unknown[] = [],
): Promise<Row[]> {
  const client = new pg.Client({ connectionString: database.url });
  await client.connect();
  try {
    return (await client.query<Row>(text, values)).rows;
  } finally {
    await client.end();
  }
}

async function emailsTo(address: string) {
  return (await email.readOutbox(testAuth.outbox)).filter(
    (message) => message.to === address,
  );
}

/** Adds someone to an organization directly, as the owner could. */
async function addMember(organizationId: string, name: string, role: string) {
  const browser = await signedUp(name);
  const userId = await browser.userId();
  const [member] = await asOwner<{ id: string }>(
    "insert into members (organization_id, user_id, role) values ($1, $2, $3) returning id",
    [organizationId, userId, role],
  );
  await browser.post("/organization/set-active", { organizationId });
  return { browser, memberId: member?.id ?? "" };
}

/** Signs up, confirms the email from the outbox, and returns the browser. */
async function signedUp(name: string): Promise<Browser> {
  const browser = testAuth.browser();
  const reply = await browser.post("/sign-up/email", {
    name,
    email: demo(name),
    password,
  });
  expect(reply.status).toBe(200);
  expect(
    await browser.confirm(await testAuth.linkFor(demo(name)), password),
  ).toBeUndefined();
  expect(await browser.userId()).not.toBeNull();
  return browser;
}

/** Asks for a reset link and returns its token, as the reset page gets it. */
async function resetToken(name: string): Promise<string> {
  const asked = await testAuth.browser().post("/request-password-reset", {
    email: demo(name),
    redirectTo: "/reset-password",
  });
  expect(asked.status).toBe(200);
  const followed = await testAuth
    .browser()
    .visit(await testAuth.linkFor(demo(name)));
  expect(followed.status).toBe(302);
  const location = new URL(followed.location ?? "", "http://localhost:3000");
  expect(location.pathname).toBe("/reset-password");
  return location.searchParams.get("token") ?? "";
}

async function ownerOfNewOrganization(name: string) {
  const owner = await signedUp(name);
  const created = await owner.post("/organization/create", {
    name: "Honeycomb Design Studio (demo)",
    slug: `honeycomb-${name}`,
  });
  expect(created.status).toBe(200);
  return { owner, organizationId: created.body?.id as string };
}

describe("email and password", () => {
  it("won't sign someone in until they confirm their email", async () => {
    const browser = testAuth.browser();
    await browser.post("/sign-up/email", {
      name: "Unconfirmed",
      email: demo("unconfirmed"),
      password,
    });
    const early = await browser.post("/sign-in/email", {
      email: demo("unconfirmed"),
      password,
    });
    expect(early.status).toBe(403);
    expect(await browser.userId()).toBeNull();

    expect(
      await browser.confirm(
        await testAuth.linkFor(demo("unconfirmed")),
        password,
      ),
    ).toBeUndefined();
    expect(await browser.userId()).not.toBeNull();
  });

  it("confirms an address only with the account's password", async () => {
    const browser = testAuth.browser();
    await browser.post("/sign-up/email", {
      name: "Careful",
      email: demo("careful"),
      password,
    });
    const link = await testAuth.linkFor(demo("careful"));
    expect(new URL(link).pathname).toBe("/confirm-email");
    expect(await browser.confirm(link, "not the right password")).toBe(
      "WRONG_PASSWORD",
    );
    expect(await browser.userId()).toBeNull();
    expect(await browser.confirm(link, password)).toBeUndefined();
    expect(await browser.userId()).not.toBeNull();
    expect(await testAuth.browser().confirm(link, password)).toBe(
      "CONFIRMED_ALREADY",
    );
  });

  it("answers a made-up link the same for every address and password, so it reveals nothing", async () => {
    const forged = (address: string) =>
      `http://localhost:3000/confirm-email?token=eyJhbGciOiJIUzI1NiJ9.${Buffer.from(
        JSON.stringify({ email: address }),
      ).toString("base64url")}.forged`;
    await testAuth.browser().post("/sign-up/email", {
      name: "Forged",
      email: demo("forged"),
      password,
    });
    await signedUp("forgedconfirmed");
    const browser = testAuth.browser();
    for (const address of [
      demo("forged"),
      demo("forgedconfirmed"),
      demo("forged-nobody"),
    ]) {
      for (const guess of [password, "not the right password"]) {
        expect(await browser.confirm(forged(address), guess)).toBe(
          "INVALID_LINK",
        );
      }
    }
    expect(
      await browser.confirm(
        "http://localhost:3000/confirm-email?token=x.y",
        password,
      ),
    ).toBe("INVALID_LINK");
    expect(await browser.userId()).toBeNull();
  });

  it("refuses a real link that has expired or that changes an address", async () => {
    await testAuth.browser().post("/sign-up/email", {
      name: "Stale Link",
      email: demo("stalelink"),
      password,
    });
    const expired = await signJWT(
      { email: demo("stalelink") },
      testSecret,
      -60,
    );
    const changing = await signJWT(
      { email: demo("stalelink"), updateTo: demo("stalelink-new") },
      testSecret,
    );
    const browser = testAuth.browser();
    for (const token of [expired, changing]) {
      expect(
        await browser.confirm(
          `http://localhost:3000/confirm-email?token=${token}`,
          password,
        ),
      ).toBe("INVALID_LINK");
    }
    expect(await browser.userId()).toBeNull();
  });

  it("keeps where the person was going in the confirmation link", async () => {
    await testAuth.browser().post("/sign-up/email", {
      name: "Going Somewhere",
      email: demo("goingsomewhere"),
      password,
      callbackURL: "/invitations/demo-invitation",
    });
    const link = new URL(await testAuth.linkFor(demo("goingsomewhere")));
    expect(link.searchParams.get("next")).toBe("/invitations/demo-invitation");
  });

  it("refuses a password shorter than 12 characters", async () => {
    const reply = await testAuth.browser().post("/sign-up/email", {
      name: "Short",
      email: demo("short"),
      password: "eleven-char",
    });
    expect(reply.status).toBe(400);
  });

  it("refuses a password longer than 128 characters", async () => {
    const reply = await testAuth.browser().post("/sign-up/email", {
      name: "Long",
      email: demo("long"),
      password: "x".repeat(129),
    });
    expect(reply.status).toBe(400);
  });

  it("sends a new confirmation link when the right password meets an unconfirmed address", async () => {
    const browser = testAuth.browser();
    await browser.post("/sign-up/email", {
      name: "Late",
      email: demo("late"),
      password,
    });
    expect(await emailsTo(demo("late"))).toHaveLength(1);

    const wrong = await browser.post("/sign-in/email", {
      email: demo("late"),
      password: "not the right password",
    });
    expect(wrong.status).toBe(401);
    expect(await emailsTo(demo("late"))).toHaveLength(1);

    const right = await browser.post("/sign-in/email", {
      email: demo("late"),
      password,
    });
    expect(right.status).toBe(403);
    expect(right.body?.code).toBe("EMAIL_NOT_VERIFIED");
    const sent = await emailsTo(demo("late"));
    expect(sent.map(({ subject }) => subject)).toEqual([
      "Confirm your email for BeeKeeping",
      "Confirm your email for BeeKeeping",
    ]);
  });

  it("answers a repeat sign-up as usual, and tells the address's owner", async () => {
    await signedUp("repeat");
    const again = await testAuth.browser().post("/sign-up/email", {
      name: "Someone Else",
      email: demo("repeat"),
      password: "another password here",
    });
    expect(again.status).toBe(200);
    const newest = await testAuth.newestEmail(demo("repeat"));
    expect(newest.subject).toBe("You already have a BeeKeeping account");
  });

  it("has no public endpoints for sending or using a confirmation link", async () => {
    const reply = await testAuth.browser().post("/send-verification-email", {
      email: demo("anyone"),
    });
    expect(reply.status).toBe(404);
    await testAuth.browser().post("/sign-up/email", {
      name: "Straight Through",
      email: demo("straightthrough"),
      password,
    });
    const token =
      new URL(await testAuth.linkFor(demo("straightthrough"))).searchParams.get(
        "token",
      ) ?? "";
    const browser = testAuth.browser();
    const direct = await browser.get(`/verify-email?token=${token}`);
    expect(direct.status).toBe(404);
    expect(await browser.userId()).toBeNull();
  });

  it("refuses a confirmation posted from another site, with cookies or without", async () => {
    await testAuth.browser().post("/sign-up/email", {
      name: "Cross Site",
      email: demo("crosssite"),
      password,
    });
    const link = await testAuth.linkFor(demo("crosssite"));
    const token = new URL(link).searchParams.get("token") ?? "";
    // The headers a request from another site would carry if it got past
    // the browser. A browser sends this JSON across sites only after a
    // preflight the app never allows, and the router checks origins only
    // for requests with cookies.
    const fromElsewhere: Record<string, string>[] = [
      { origin: "https://evil.example" },
      { origin: "https://evil.example", cookie: "theme=dark" },
      { "sec-fetch-site": "cross-site", "sec-fetch-mode": "cors" },
      {
        origin: "null",
        "sec-fetch-site": "cross-site",
        "sec-fetch-mode": "no-cors",
      },
      {
        origin: "https://evil.example",
        "sec-fetch-site": "cross-site",
        "sec-fetch-mode": "navigate",
      },
    ];
    for (const headers of fromElsewhere) {
      const reply = await handleAuthRequest(
        testAuth.auth,
        new Request(`${baseUrl}/api/auth/confirm-email`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-real-ip": "203.0.113.9",
            ...headers,
          },
          body: JSON.stringify({ token, password }),
        }),
      );
      expect(reply.status, JSON.stringify(headers)).toBe(403);
      expect(reply.headers.getSetCookie(), JSON.stringify(headers)).toEqual([]);
    }
    // The link still waits for the address's owner.
    expect(await testAuth.browser().confirm(link, password)).toBeUndefined();
  });

  it("checks callback addresses in tests too", async () => {
    const reply = await testAuth.browser().post("/sign-up/email", {
      name: "Elsewhere",
      email: demo("elsewhere"),
      password,
      callbackURL: "//evil.example/",
    });
    expect(reply.status).toBe(403);
  });

  it("refuses a wrong password", async () => {
    await signedUp("wrongpass");
    const reply = await testAuth.browser().post("/sign-in/email", {
      email: demo("wrongpass"),
      password: "not the right password",
    });
    expect(reply.status).toBe(401);
  });
});

describe("magic links", () => {
  it("emails a link that signs the person in", async () => {
    await signedUp("linkuser");
    const browser = testAuth.browser();
    const sent = await browser.post("/sign-in/magic-link", {
      email: demo("linkuser"),
      callbackURL: "/",
    });
    expect(sent.status).toBe(200);
    const link = await testAuth.linkFor(demo("linkuser"));
    expect(link).toContain("/api/auth/magic-link/verify");
    await browser.visit(link);
    expect(await browser.userId()).not.toBeNull();
  });
});

describe("magic links, for accounts that exist", () => {
  it("never create an account: an unknown address gets a note, not a link", async () => {
    const browser = testAuth.browser();
    const sent = await browser.post("/sign-in/magic-link", {
      email: demo("stranger-by-link"),
      callbackURL: "/",
    });
    expect(sent.status).toBe(200);
    const note = await testAuth.newestEmail(demo("stranger-by-link"));
    expect(note.subject).toBe("There's no BeeKeeping account for this address");
    expect(note.text).not.toContain("/api/auth/");
    expect(
      await asOwner("select 1 from users where email = $1", [
        demo("stranger-by-link"),
      ]),
    ).toEqual([]);
  });

  it("send a link that didn't work back to the page that asked, with an error", async () => {
    await signedUp("usedlink");
    const browser = testAuth.browser();
    await browser.post("/sign-in/magic-link", {
      email: demo("usedlink"),
      callbackURL: "/",
      errorCallbackURL: "/sign-in?next=%2Finvitations%2F1",
    });
    const link = await testAuth.linkFor(demo("usedlink"));
    await browser.visit(link);
    const again = await testAuth.browser().visit(link);
    expect(again.status).toBe(302);
    const location = new URL(again.location ?? "", "http://localhost:3000");
    expect(location.pathname).toBe("/sign-in");
    expect(location.searchParams.get("next")).toBe("/invitations/1");
    expect(location.searchParams.get("error")).not.toBeNull();
  });

  it("last ten minutes, and the table keeps only a hash of the token", async () => {
    await signedUp("shortlink");
    await testAuth.browser().post("/sign-in/magic-link", {
      email: demo("shortlink"),
      callbackURL: "/",
    });
    const link = new URL(await testAuth.linkFor(demo("shortlink")));
    const token = link.searchParams.get("token") ?? "";
    expect(token).not.toBe("");
    const [row] = await asOwner<{ identifier: string; minutes: number }>(
      `select identifier,
              extract(epoch from expires_at - now()) / 60 as minutes
         from verifications order by created_at desc limit 1`,
    );
    expect(row?.identifier).not.toContain(token);
    expect(Number(row?.minutes)).toBeGreaterThan(9);
    expect(Number(row?.minutes)).toBeLessThanOrEqual(10);
  });
});

describe("magic links with two-factor on", () => {
  it("never sign in someone who turned on two-factor", async () => {
    const browser = await signedUp("linktwofactor");
    // A link asked for while two-factor was still off.
    const early = testAuth.browser();
    await early.post("/sign-in/magic-link", {
      email: demo("linktwofactor"),
      callbackURL: "/",
    });
    const earlyLink = await testAuth.linkFor(demo("linktwofactor"));

    const enabled = await browser.post("/two-factor/enable", { password });
    const secret = new URL(enabled.body?.totpURI as string).searchParams.get(
      "secret",
    );
    const confirmed = await browser.post("/two-factor/verify-totp", {
      code: authenticatorCode(secret ?? ""),
    });
    expect(confirmed.status).toBe(200);

    // The early link now signs no one in.
    await early.visit(earlyLink);
    expect(await early.userId()).toBeNull();

    // A new request gets the same answer, but the email has no link that
    // signs in, only one to the sign-in page.
    const later = testAuth.browser();
    const sent = await later.post("/sign-in/magic-link", {
      email: demo("linktwofactor"),
      callbackURL: "/",
    });
    expect(sent.status).toBe(200);
    const newest = await testAuth.newestEmail(demo("linktwofactor"));
    expect(newest.subject).toBe("Sign in to BeeKeeping with your code");
    expect(newest.text).not.toContain("/api/auth/magic-link/verify");
  });
});

describe("organizations and roles", () => {
  it("makes whoever creates an organization its owner", async () => {
    const { owner } = await ownerOfNewOrganization("creator");
    const member = await owner.get("/organization/get-active-member");
    expect(member.body?.role).toBe("owner");
  });

  it("lets an owner invite a bookkeeper, who joins as a bookkeeper", async () => {
    const { owner, organizationId } = await ownerOfNewOrganization("inviter");
    const invited = await owner.post("/organization/invite-member", {
      email: demo("bookkeeper"),
      role: "bookkeeper",
    });
    expect(invited.status).toBe(200);
    const invitationLink = await testAuth.linkFor(demo("bookkeeper"));
    const invitationId = invitationLink.split("/invitations/")[1];
    expect(invitationId).toBe(invited.body?.id);

    const bookkeeper = await signedUp("bookkeeper");
    const accepted = await bookkeeper.post("/organization/accept-invitation", {
      invitationId,
    });
    expect(accepted.status).toBe(200);
    const member = await bookkeeper.get("/organization/get-active-member");
    expect(member.body?.role).toBe("bookkeeper");
    expect(member.body?.organizationId).toBe(organizationId);

    // A bookkeeper keeps the books but can't manage members.
    const refused = await bookkeeper.post("/organization/invite-member", {
      email: demo("someone-else"),
      role: "viewer",
    });
    expect(refused.status).toBe(403);
  });

  it("starts a new session in someone's only organization", async () => {
    const { organizationId } = await ownerOfNewOrganization("oneorg");
    const later = testAuth.browser();
    await later.post("/sign-in/email", { email: demo("oneorg"), password });
    const member = await later.get("/organization/get-active-member");
    expect(member.body?.organizationId).toBe(organizationId);
    expect(member.body?.role).toBe("owner");
  });

  it("lets someone in two organizations choose one", async () => {
    const { owner } = await ownerOfNewOrganization("twoorgs");
    const second = await owner.post("/organization/create", {
      name: "Second Demo Studio (demo)",
      slug: "second-twoorgs",
    });
    expect(second.status).toBe(200);
    const later = testAuth.browser();
    await later.post("/sign-in/email", { email: demo("twoorgs"), password });
    const session = await later.get("/get-session");
    const active = (session.body?.session as { activeOrganizationId?: unknown })
      .activeOrganizationId;
    expect(active ?? null).toBeNull();
  });

  it("won't let anyone else see or accept an invitation", async () => {
    const { owner } = await ownerOfNewOrganization("guarded");
    const invited = await owner.post("/organization/invite-member", {
      email: demo("intended"),
      role: "viewer",
    });
    const stranger = await signedUp("stranger");
    const seen = await stranger.get(
      `/organization/get-invitation?id=${String(invited.body?.id)}`,
    );
    expect(seen.status).toBe(403);
    const reply = await stranger.post("/organization/accept-invitation", {
      invitationId: invited.body?.id,
    });
    expect(reply.status).toBe(403);
  });

  it("refuses an admin's requests about an organization they don't belong to", async () => {
    const theirs = await ownerOfNewOrganization("otherowner");
    const { owner: admin } = await ownerOfNewOrganization("nosyowner");
    const { memberId } = await addMember(
      theirs.organizationId,
      "theirmember",
      "viewer",
    );
    const organizationId = theirs.organizationId;
    const replies = [
      await admin.post("/organization/invite-member", {
        email: demo("smuggled"),
        role: "viewer",
        organizationId,
      }),
      await admin.post("/organization/remove-member", {
        memberIdOrEmail: memberId,
        organizationId,
      }),
      await admin.post("/organization/update-member-role", {
        memberId,
        role: "admin",
        organizationId,
      }),
      await admin.get(
        `/organization/get-full-organization?organizationId=${organizationId}`,
      ),
      await admin.post("/organization/set-active", { organizationId }),
    ];
    for (const reply of replies) {
      expect(reply.status).toBeGreaterThanOrEqual(400);
      expect(reply.status).toBeLessThan(500);
    }
    expect(
      await asOwner("select 1 from invitations where email = $1", [
        demo("smuggled"),
      ]),
    ).toEqual([]);
  });

  it("refuses a rename past the limit, and takes one within it", async () => {
    const { owner, organizationId } =
      await ownerOfNewOrganization("longrename");
    const long = await owner.post("/organization/update", {
      organizationId,
      data: { name: "x".repeat(201) },
    });
    expect(long.status).toBe(400);
    const fine = await owner.post("/organization/update", {
      organizationId,
      data: { name: "Honeycomb Design Studio, renamed (demo)" },
    });
    expect(fine.status).toBe(200);
  });

  it("refuses an organization name past the limit", async () => {
    const owner = await signedUp("longname");
    const reply = await owner.post("/organization/create", {
      name: "x".repeat(201),
      slug: "long-name-demo",
    });
    expect(reply.status).toBe(400);
  });

  it("never invites anyone as an owner", async () => {
    const { owner } = await ownerOfNewOrganization("nosecondowner");
    const reply = await owner.post("/organization/invite-member", {
      email: demo("would-be-owner"),
      role: "owner",
    });
    expect(reply.status).toBe(400);
  });

  it("never removes the only owner", async () => {
    const { owner, organizationId } = await ownerOfNewOrganization("keeper");
    const me = await owner.get("/organization/get-active-member");
    const reply = await owner.post("/organization/remove-member", {
      memberIdOrEmail: me.body?.id,
      organizationId,
    });
    expect(reply.status).toBe(400);
    const still = await owner.get("/organization/get-active-member");
    expect(still.body?.role).toBe("owner");
  });

  it("never removes an owner, even when there are two", async () => {
    const { owner, organizationId } =
      await ownerOfNewOrganization("firstowner");
    const second = await signedUp("secondowner");
    const secondId = await second.userId();
    // BeeKeeping never makes a second owner itself, so the test adds one as
    // the database owner.
    const client = new pg.Client({ connectionString: database.url });
    await client.connect();
    const inserted = await client.query<{ id: string }>(
      "insert into members (organization_id, user_id, role) values ($1, $2, 'owner') returning id",
      [organizationId, secondId],
    );
    await client.end();

    const reply = await owner.post("/organization/remove-member", {
      memberIdOrEmail: inserted.rows[0]?.id,
      organizationId,
    });
    expect(reply.status).toBe(403);
  });
});

describe("changing and removing members", () => {
  it("never makes anyone an owner by changing a role", async () => {
    const { owner, organizationId } = await ownerOfNewOrganization("promoter");
    const { memberId } = await addMember(
      organizationId,
      "promoted",
      "bookkeeper",
    );
    for (const role of ["owner", ["admin", "owner"], ["admin", "viewer"]]) {
      const refused = await owner.post("/organization/update-member-role", {
        memberId,
        role,
        organizationId,
      });
      expect(refused.status).toBe(403);
    }
    const allowed = await owner.post("/organization/update-member-role", {
      memberId,
      role: "admin",
      organizationId,
    });
    expect(allowed.status).toBe(200);
  });

  it("ends a removed member's access at once", async () => {
    const { owner, organizationId } = await ownerOfNewOrganization("remover");
    const { browser, memberId } = await addMember(
      organizationId,
      "removed",
      "bookkeeper",
    );
    expect((await browser.get("/organization/get-active-member")).status).toBe(
      200,
    );
    const removed = await owner.post("/organization/remove-member", {
      memberIdOrEmail: memberId,
      organizationId,
    });
    expect(removed.status).toBe(200);
    expect(
      (await browser.get("/organization/get-active-member")).status,
    ).toBeGreaterThanOrEqual(400);
  });

  it("keeps an organization from being deleted", async () => {
    const { owner, organizationId } = await ownerOfNewOrganization("keeper2");
    const reply = await owner.post("/organization/delete", { organizationId });
    expect(reply.status).toBeGreaterThanOrEqual(400);
    expect(
      await asOwner("select 1 from organizations where id = $1", [
        organizationId,
      ]),
    ).toHaveLength(1);
  });
});

describe("a forgotten password", () => {
  it("resets once, ends every session, and still asks for the two-factor code", async () => {
    const browser = await signedUp("forgetful");
    const enabled = await browser.post("/two-factor/enable", { password });
    const secret =
      new URL(enabled.body?.totpURI as string).searchParams.get("secret") ?? "";
    await browser.post("/two-factor/verify-totp", {
      code: authenticatorCode(secret),
    });

    const token = await resetToken("forgetful");
    const newPassword = "a brand new passphrase";
    const reset = await testAuth
      .browser()
      .post("/reset-password", { newPassword, token });
    expect(reset.status).toBe(200);
    expect(await browser.userId()).toBeNull();
    const reused = await testAuth.browser().post("/reset-password", {
      newPassword: "yet another passphrase",
      token,
    });
    expect(reused.status).toBe(400);

    const later = testAuth.browser();
    const old = await later.post("/sign-in/email", {
      email: demo("forgetful"),
      password,
    });
    expect(old.status).toBe(401);
    const signIn = await later.post("/sign-in/email", {
      email: demo("forgetful"),
      password: newPassword,
    });
    expect(signIn.body?.twoFactorRedirect).toBe(true);
    expect(await later.userId()).toBeNull();
  });

  it("gives back a password Better Auth removed when a link proved the address", async () => {
    // Signed up, never confirmed, then signed in by link: Better Auth
    // removes the password nobody proved.
    const browser = testAuth.browser();
    await browser.post("/sign-up/email", {
      name: "Linked Late",
      email: demo("linkedlate"),
      password,
    });
    await browser.post("/sign-in/magic-link", {
      email: demo("linkedlate"),
      callbackURL: "/",
    });
    await browser.visit(await testAuth.linkFor(demo("linkedlate")));
    expect(await browser.userId()).not.toBeNull();
    const gone = await testAuth.browser().post("/sign-in/email", {
      email: demo("linkedlate"),
      password,
    });
    expect(gone.status).toBe(401);

    const token = await resetToken("linkedlate");
    await testAuth.browser().post("/reset-password", {
      newPassword: password,
      token,
    });
    const back = testAuth.browser();
    await back.post("/sign-in/email", { email: demo("linkedlate"), password });
    expect(await back.userId()).not.toBeNull();
  });

  it("answers an address with no account the same, with a note that points to sign-up", async () => {
    const asked = await testAuth.browser().post("/request-password-reset", {
      email: demo("nobody-here"),
      redirectTo: "/reset-password",
    });
    expect(asked.status).toBe(200);
    const note = await testAuth.newestEmail(demo("nobody-here"));
    expect(note.subject).toBe("There's no BeeKeeping account for this address");
  });

  it("lasts 30 minutes, and the table keeps only a hash of the token", async () => {
    await signedUp("halfhour");
    const token = await resetToken("halfhour");
    expect(token).not.toBe("");
    const [row] = await asOwner<{ identifier: string; minutes: number }>(
      `select identifier, extract(epoch from expires_at - now()) / 60 as minutes
         from verifications order by created_at desc limit 1`,
    );
    expect(row?.identifier).not.toContain(token);
    expect(row?.identifier).not.toContain("reset-password:");
    expect(Number(row?.minutes)).toBeGreaterThan(29);
    expect(Number(row?.minutes)).toBeLessThanOrEqual(30);
  });

  it("sends a known address only its reset link", async () => {
    await signedUp("knownreset");
    await resetToken("knownreset");
    const subjects = (await emailsTo(demo("knownreset"))).map(
      (message) => message.subject,
    );
    expect(subjects).toContain("Reset your BeeKeeping password");
    expect(subjects).not.toContain(
      "There's no BeeKeeping account for this address",
    );
  });

  it("sends nothing to an address Better Auth refuses", async () => {
    const reply = await testAuth.browser().post("/request-password-reset", {
      email: `Riley <${demo("displayname")}>`,
      redirectTo: "/reset-password",
    });
    expect(reply.status).toBe(400);
    expect(await emailsTo(demo("displayname"))).toEqual([]);
    expect(await emailsTo(`Riley <${demo("displayname")}>`)).toEqual([]);
  });

  it("sends nothing for a request Better Auth refuses, so its timing matches for every address", async () => {
    await signedUp("refusedreset");
    for (const redirectTo of [null, 0]) {
      for (const name of ["refusedreset", "refused-nobody"]) {
        const reply = await testAuth.browser().post("/request-password-reset", {
          email: demo(name),
          redirectTo,
        });
        expect(reply.status).toBe(400);
      }
    }
    expect(await emailsTo(demo("refused-nobody"))).toEqual([]);
    expect(
      (await emailsTo(demo("refusedreset"))).map((message) => message.subject),
    ).toEqual(["Confirm your email for BeeKeeping"]);
  });
});

describe("names", () => {
  const tooLong = "a".repeat(101);

  it("refuse a name past the limit at sign-up, for a new address and a known one alike", async () => {
    await signedUp("namedalready");
    for (const name of ["namedalready", "namednew"]) {
      const reply = await testAuth.browser().post("/sign-up/email", {
        name: tooLong,
        email: demo(name),
        password,
      });
      expect(reply.status).toBe(400);
    }
    expect(await emailsTo(demo("namednew"))).toEqual([]);
    expect(await emailsTo(demo("namedalready"))).toHaveLength(1);
  });

  it("refuse a change to a name past the limit, and take one within it", async () => {
    const browser = await signedUp("renamed");
    expect((await browser.post("/update-user", { name: tooLong })).status).toBe(
      400,
    );
    expect(
      (await browser.post("/update-user", { name: "a".repeat(100) })).status,
    ).toBe(200);
  });
});

describe("an account someone else started with your address", () => {
  it("can't be confirmed by your click, and your reset shuts them out", async () => {
    const address = demo("startedbyother");
    const theirs = "someone else's passphrase";
    const other = testAuth.browser();
    await other.post("/sign-up/email", {
      name: "Security Desk",
      email: address,
      password: theirs,
    });
    // The owner signs up too, then opens the confirmation link in their
    // inbox, which the other sign-up sent.
    const owner = testAuth.browser();
    await owner.post("/sign-up/email", {
      name: "Morgan Diaz",
      email: address,
      password,
    });
    const confirmation = (await emailsTo(address))
      .find(({ subject }) => subject === "Confirm your email for BeeKeeping")
      ?.text.match(/https?:\/\/\S+/)?.[0];
    expect(await owner.confirm(confirmation ?? "", password)).toBe(
      "WRONG_PASSWORD",
    );
    expect(await owner.userId()).toBeNull();
    const early = await testAuth
      .browser()
      .post("/sign-in/email", { email: address, password: theirs });
    expect(early.body?.code).toBe("EMAIL_NOT_VERIFIED");

    // The owner chooses a password of their own, then confirms with it.
    const newPassword = "a brand new passphrase";
    const reset = await testAuth.browser().post("/reset-password", {
      newPassword,
      token: await resetToken("startedbyother"),
    });
    expect(reset.status).toBe(200);
    await owner.post("/sign-in/email", {
      email: address,
      password: newPassword,
    });
    expect(
      await owner.confirm(await testAuth.linkFor(address), newPassword),
    ).toBeUndefined();
    expect(await owner.userId()).not.toBeNull();
    const shutOut = await testAuth
      .browser()
      .post("/sign-in/email", { email: address, password: theirs });
    expect(shutOut.status).toBe(401);
  });
});

describe("sessions", () => {
  it("signs out every browser at once", async () => {
    const laptop = await signedUp("everywhere");
    const phone = testAuth.browser();
    await phone.post("/sign-in/email", { email: demo("everywhere"), password });
    expect(await phone.userId()).not.toBeNull();

    await laptop.post("/revoke-sessions");

    expect(await laptop.userId()).toBeNull();
    expect(await phone.userId()).toBeNull();
  });
});

describe("two-factor sign-in", () => {
  it("asks for an authenticator code once it's on", async () => {
    const browser = await signedUp("twofactor");
    const enabled = await browser.post("/two-factor/enable", { password });
    expect(enabled.status).toBe(200);
    const secret = new URL(enabled.body?.totpURI as string).searchParams.get(
      "secret",
    );
    expect(secret).toBeTruthy();
    const confirmed = await browser.post("/two-factor/verify-totp", {
      code: authenticatorCode(secret ?? ""),
    });
    expect(confirmed.status).toBe(200);

    const later = testAuth.browser();
    const first = await later.post("/sign-in/email", {
      email: demo("twofactor"),
      password,
    });
    expect(first.body?.twoFactorRedirect).toBe(true);
    expect(await later.userId()).toBeNull();

    const wrong = await later.post("/two-factor/verify-totp", {
      code: "000000",
    });
    expect(wrong.status).toBe(401);
    const right = await later.post("/two-factor/verify-totp", {
      code: authenticatorCode(secret ?? ""),
    });
    expect(right.status).toBe(200);
    expect(await later.userId()).not.toBeNull();
  });
});

describe("backup codes", () => {
  it("sign someone in once each when the authenticator is lost", async () => {
    const browser = await signedUp("backup");
    const enabled = await browser.post("/two-factor/enable", { password });
    const secret = new URL(enabled.body?.totpURI as string).searchParams.get(
      "secret",
    );
    const [code] = enabled.body?.backupCodes as string[];
    await browser.post("/two-factor/verify-totp", {
      code: authenticatorCode(secret ?? ""),
    });

    const later = testAuth.browser();
    await later.post("/sign-in/email", { email: demo("backup"), password });
    const used = await later.post("/two-factor/verify-backup-code", { code });
    expect(used.status).toBe(200);
    expect(await later.userId()).not.toBeNull();

    const again = testAuth.browser();
    await again.post("/sign-in/email", { email: demo("backup"), password });
    const reused = await again.post("/two-factor/verify-backup-code", { code });
    expect(reused.status).toBeGreaterThanOrEqual(400);
    expect(await again.userId()).toBeNull();
  });
});

describe("rate limits", () => {
  it("refuse the sixth confirmation try in a minute from one address", async () => {
    await testAuth.browser().post("/sign-up/email", {
      name: "Guesser",
      email: demo("guesser"),
      password,
    });
    const link = await testAuth.linkFor(demo("guesser"));
    const limited = createTestAuth(database.appUrl, { rateLimit: true });
    try {
      const browser = limited.browser("203.0.113.77");
      const answers: (string | undefined)[] = [];
      for (let attempt = 0; attempt < 6; attempt += 1) {
        answers.push(await browser.confirm(link, "not the right password"));
      }
      expect(answers).toEqual([
        ...Array<string>(5).fill("WRONG_PASSWORD"),
        "429",
      ]);
      // Another address still gets its answer.
      expect(
        await limited.browser("203.0.113.78").confirm(link, "not it either"),
      ).toBe("WRONG_PASSWORD");
    } finally {
      await limited.close();
    }
  });

  it("allow three resets, ten invitations and five new organizations a minute from one address", async () => {
    await ownerOfNewOrganization("busyowner");
    const limited = createTestAuth(database.appUrl, { rateLimit: true });
    try {
      const statuses = async (count: number, send: () => Promise<number>) => {
        const seen: number[] = [];
        for (let index = 0; index < count; index += 1) seen.push(await send());
        return seen;
      };
      const resets = await statuses(4, async () => {
        const reply = await limited
          .browser("198.51.100.20")
          .post("/request-password-reset", {
            email: demo("busyowner"),
            redirectTo: "/reset-password",
          });
        return reply.status;
      });
      expect(resets).toEqual([200, 200, 200, 429]);

      const owner = limited.browser("198.51.100.21");
      await owner.post("/sign-in/email", {
        email: demo("busyowner"),
        password,
      });
      let invited = 0;
      const invitations = await statuses(11, async () => {
        invited += 1;
        const reply = await owner.post("/organization/invite-member", {
          email: demo(`busyinvitee${invited}`),
          role: "viewer",
        });
        return reply.status;
      });
      expect(invitations.slice(0, 10).every((status) => status === 200)).toBe(
        true,
      );
      expect(invitations[10]).toBe(429);

      const creator = limited.browser("198.51.100.22");
      await creator.post("/sign-in/email", {
        email: demo("busyowner"),
        password,
      });
      let made = 0;
      const organizations = await statuses(6, async () => {
        made += 1;
        const reply = await creator.post("/organization/create", {
          name: `Busy Studio ${made} (demo)`,
          slug: `busy-studio-${made}`,
        });
        return reply.status;
      });
      expect(organizations).toEqual([200, 200, 200, 200, 200, 429]);
    } finally {
      await limited.close();
    }
  });

  it("refuse the sixth sign-in in a minute from one address, and only from it", async () => {
    await signedUp("limited");
    const limited = createTestAuth(database.appUrl, { rateLimit: true });
    try {
      const attempt = (address: string) =>
        limited.browser(address).post("/sign-in/email", {
          email: demo("limited"),
          password: "not the right password",
        });
      const statuses = [];
      for (let count = 0; count < 6; count += 1) {
        statuses.push((await attempt("198.51.100.7")).status);
      }
      expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
      expect((await attempt("198.51.100.8")).status).toBe(401);
      // The counts live in Postgres, so every server shares them.
      const rows = await asOwner<{ key: string }>(
        "select key from rate_limits where key like '%198.51.100.7%'",
      );
      expect(rows.length).toBeGreaterThan(0);
    } finally {
      await limited.close();
    }
  });
});

describe("when an email can't be sent", () => {
  // A file where the outbox folder should be, so every email fails.
  const folder = mkdtempSync(join(tmpdir(), "beekeeping-"));
  const blocked = join(folder, "blocked");
  writeFileSync(blocked, "");
  afterAll(() => rmSync(folder, { recursive: true, force: true }));
  const transport = {
    kind: "outbox",
    dir: blocked,
    from: "BeeKeeping <test@beekeeping.test>",
  } as const;

  it("answers 503 to a sign-up, not 200", async () => {
    const failing = createTestAuth(database.appUrl, { transport });
    try {
      const reply = await failing.browser().post("/sign-up/email", {
        name: "Unsent",
        email: demo("unsent"),
        password,
      });
      expect(reply.status).toBe(503);
      expect(reply.body?.message).toBe(
        "We couldn't send the email. Try again in a minute.",
      );
    } finally {
      await failing.close();
    }
  });

  it("answers 503 to a repeat sign-up too, so a failure reveals no account", async () => {
    await signedUp("unsentrepeat");
    const failing = createTestAuth(database.appUrl, { transport });
    try {
      const reply = await failing.browser().post("/sign-up/email", {
        name: "Someone Else",
        email: demo("unsentrepeat"),
        password: "another password here",
      });
      expect(reply.status).toBe(503);
    } finally {
      await failing.close();
    }
  });

  it("answers 503 when the right password can't send a new confirmation link", async () => {
    const browser = testAuth.browser();
    await browser.post("/sign-up/email", {
      name: "Unsent Late",
      email: demo("unsentlate"),
      password,
    });
    const failing = createTestAuth(database.appUrl, { transport });
    try {
      const reply = await failing.browser().post("/sign-in/email", {
        email: demo("unsentlate"),
        password,
      });
      expect(reply.status).toBe(503);
      expect(reply.body?.code).toBe("EMAIL_NOT_SENT");
    } finally {
      await failing.close();
    }
  });

  it("answers 503 to a reset for any address", async () => {
    await signedUp("unsentreset");
    const failing = createTestAuth(database.appUrl, { transport });
    try {
      for (const name of ["unsentreset", "unsent-nobody"]) {
        const reply = await failing.browser().post("/request-password-reset", {
          email: demo(name),
          redirectTo: "/reset-password",
        });
        expect(reply.status).toBe(503);
      }
    } finally {
      await failing.close();
    }
  });

  it("answers 503 to an invitation, not 200", async () => {
    await ownerOfNewOrganization("unsentinviter");
    const failing = createTestAuth(database.appUrl, { transport });
    try {
      const owner = failing.browser();
      await owner.post("/sign-in/email", {
        email: demo("unsentinviter"),
        password,
      });
      const reply = await owner.post("/organization/invite-member", {
        email: demo("never-told"),
        role: "viewer",
      });
      expect(reply.status).toBe(503);
    } finally {
      await failing.close();
    }
  });
});

describe("a query that fails inside /api/auth", () => {
  it("answers 500 to a failed insert and logs one line with a code, never the query or its values", async () => {
    const broken = await createTestDatabase();
    const failing = createTestAuth(broken.appUrl);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const browser = failing.browser();
      await browser.post("/sign-up/email", {
        name: "Broken",
        email: demo("broken"),
        password,
      });
      expect(
        await browser.confirm(await failing.linkFor(demo("broken")), password),
      ).toBeUndefined();
      const client = new pg.Client({ connectionString: broken.url });
      await client.connect();
      // Better Auth runs as beekeeping_auth, which holds the rights on
      // sign-in's tables.
      await client.query("revoke insert on sessions from beekeeping_auth");
      await client.end();

      const reply = await failing.browser().post("/sign-in/email", {
        email: demo("broken"),
        password,
      });
      expect(reply.status).toBe(500);
      const lines = logged.mock.calls.map((call) => call.map(String).join(" "));
      expect(lines).toContain("auth error: request failed (42501)");
      expect(lines.join("\n")).not.toMatch(/insert into|params|SERVER_ERROR/i);
    } finally {
      logged.mockRestore();
      await failing.close();
      await broken.drop();
    }
  });
});

describe("Better Auth's own log lines", () => {
  it("go through the auth log, so a failed session read prints no token", async () => {
    const broken = await createTestDatabase();
    const failing = createTestAuth(broken.appUrl);
    const printed = (["error", "warn", "info", "log"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {}),
    );
    try {
      const browser = failing.browser();
      await browser.post("/sign-up/email", {
        name: "Broken Read",
        email: demo("brokenread"),
        password,
      });
      expect(
        await browser.confirm(
          await failing.linkFor(demo("brokenread")),
          password,
        ),
      ).toBeUndefined();
      const token = browser.sessionToken();
      expect(token).not.toBe("");
      const client = new pg.Client({ connectionString: broken.url });
      await client.connect();
      // Better Auth runs as beekeeping_auth, which holds the rights on
      // sign-in's tables.
      await client.query("revoke select on sessions from beekeeping_auth");
      await client.end();

      await browser.get("/get-session");
      const lines = printed
        .flatMap((spy) => spy.mock.calls)
        .map((call) => call.map(String).join(" "));
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.join("\n")).not.toContain(token);
    } finally {
      for (const spy of printed) spy.mockRestore();
      await failing.close();
      await broken.drop();
    }
  });
});

describe("the auth log", () => {
  it("keeps only the first line and an error code, never a query's parameters", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const failure = Object.assign(
        new Error(
          'Failed query: select * from "sessions" where "token" = $1\nparams: secret-session-token',
        ),
        { cause: { code: "42501" } },
      );
      logAuth("error", failure.message, failure);
      logAuth("error", failure);
      expect(logged.mock.calls).toEqual([
        [
          'auth error: Failed query: select * from "sessions" where "token" = $1 (42501)',
        ],
        ["auth error:  (42501)"],
      ]);
      expect(JSON.stringify(logged.mock.calls)).not.toContain(
        "secret-session-token",
      );
    } finally {
      logged.mockRestore();
    }
  });
});
