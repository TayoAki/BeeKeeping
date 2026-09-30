import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { invokeAction } from "@beekeeping/actions";
import { openDatabase, type DatabaseHandle } from "@beekeeping/db";
import { createTestDatabase, type TestDatabase } from "@beekeeping/db/testing";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createTestAuth,
  type TestAuth,
} from "../src/server/auth-test-browser.ts";
import { demoCompany, demoPerson } from "./demo-company.ts";
import { seedDemoCompany } from "./seed-demo.ts";

// Made up for these tests, as DEMO_PASSWORD is for each environment.
const password = "demo password for the tests";
const rotated = "a new demo password for the tests";

let database: TestDatabase;
let testAuth: TestAuth;
let app: DatabaseHandle;

beforeAll(async () => {
  database = await createTestDatabase();
  testAuth = createTestAuth(database.appUrl);
  app = openDatabase(database.appUrl, { max: 2 });
});
afterAll(async () => {
  await app.close();
  await testAuth.close();
  await database.drop();
});

function seed(withPassword = password) {
  return seedDemoCompany({
    auth: testAuth.auth,
    app: app.db,
    password: withPassword,
  });
}

/** Runs SQL as the database owner, who sets up and checks rows. */
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

/** Every row the seed writes, as it stands, to show a run left them alone. */
function rows() {
  return asOwner(`
    select (select jsonb_agg(t order by t.id) from users t) as users,
           (select jsonb_agg(t order by t.id) from accounts t) as accounts,
           (select jsonb_agg(t order by t.id) from organizations t) as organizations,
           (select jsonb_agg(t order by t.id) from members t) as members,
           (select jsonb_agg(t order by t.org_id) from organization_settings t) as settings`);
}

/** Signs in as a demo person, and answers the status and the session. */
async function signIn(email: string, withPassword: string) {
  const browser = testAuth.browser();
  const reply = await browser.post("/sign-in/email", {
    email,
    password: withPassword,
  });
  const session = await browser.get("/get-session");
  return { browser, status: reply.status, session: session.body };
}

describe("the demo company", () => {
  let organizationId = "";

  it("loads its people, its organization and its home currency", async () => {
    const result = await seed();
    organizationId = result.organizationId;
    expect(result.changes).toEqual([
      "added avery@honeycomb-demo.test",
      "added blake@honeycomb-demo.test",
      "added casey@honeycomb-demo.test",
      // Better Auth makes the creator the owner.
      "added Honeycomb Design Studio (demo)",
      "added blake@honeycomb-demo.test as bookkeeper",
      "added casey@honeycomb-demo.test as viewer",
      "set the home currency to USD",
    ]);

    // Each person signs in with the password, their address confirmed, and
    // starts in the demo company.
    const browsers = new Map<string, ReturnType<TestAuth["browser"]>>();
    for (const person of demoCompany.people) {
      const { browser, status, session } = await signIn(person.email, password);
      expect(status, person.email).toBe(200);
      expect(session).toMatchObject({
        user: { email: person.email, name: person.name, emailVerified: true },
        session: { activeOrganizationId: organizationId },
      });
      browsers.set(person.role, browser);
    }

    const owner = browsers.get("owner");
    const organization = await owner?.get(
      `/organization/get-full-organization?organizationId=${organizationId}`,
    );
    expect(organization?.body).toMatchObject({
      name: "Honeycomb Design Studio (demo)",
      slug: "honeycomb-design-studio-demo",
    });
    const members = (
      organization?.body?.members as { role: string; user: { email: string } }[]
    ).map(({ role, user }) => [user.email, role]);
    expect(members.sort()).toEqual([
      ["avery@honeycomb-demo.test", "owner"],
      ["blake@honeycomb-demo.test", "bookkeeper"],
      ["casey@honeycomb-demo.test", "viewer"],
    ]);

    const userId = await owner?.userId();
    expect(
      await invokeAction(
        app.db,
        {
          kind: "person",
          orgId: organizationId,
          userId: userId ?? "",
          role: "viewer",
        },
        "get_organization_settings",
        {},
      ),
    ).toMatchObject({ ok: true, settings: { homeCurrency: "USD" } });
  });

  it("changes nothing when it runs again", async () => {
    const before = await rows();
    expect(await seed()).toEqual({ changes: [], organizationId });
    expect(await rows()).toEqual(before);
  });

  it("gives its people a new DEMO_PASSWORD, and the old one stops working", async () => {
    const email = demoPerson("bookkeeper").email;
    const earlier = await signIn(email, password);
    expect(earlier.session).toMatchObject({ user: { email } });
    expect((await seed(rotated)).changes).toEqual([
      "set the password of avery@honeycomb-demo.test",
      "set the password of blake@honeycomb-demo.test",
      "set the password of casey@honeycomb-demo.test",
    ]);
    // Nobody stays signed in on the old password.
    expect((await earlier.browser.get("/get-session")).body).toBeNull();
    expect((await signIn(email, password)).status).toBe(401);
    expect((await signIn(email, rotated)).status).toBe(200);
  });

  it("gives a password to a person who has none, such as one who only used links", async () => {
    const email = demoPerson("viewer").email;
    await asOwner(
      `delete from accounts where provider_id = 'credential'
         and user_id = (select id from users where email = $1)`,
      [email],
    );
    expect((await signIn(email, rotated)).status).toBe(401);
    expect((await seed(rotated)).changes).toEqual([`gave ${email} a password`]);
    expect((await signIn(email, rotated)).status).toBe(200);
  });

  it("refuses a password sign-in wouldn't take", async () => {
    for (const refused of ["short", "x".repeat(129)]) {
      await expect(seed(refused)).rejects.toThrow(
        "DEMO_PASSWORD needs 12 to 128 characters.",
      );
    }
  });
});

describe("pnpm seed:demo", () => {
  /** Runs the script as staging would, with only these settings. */
  const run = (settings: Record<string, string>) =>
    spawnSync(process.execPath, [join(import.meta.dirname, "seed-demo.ts")], {
      encoding: "utf8",
      env: {
        NODE_ENV: process.env.NODE_ENV,
        PATH: process.env.PATH ?? "",
        ...settings,
      },
    });

  it("never loads production, whatever the settings say", async () => {
    const before = await rows();
    const result = run({
      RAILWAY_ENVIRONMENT_NAME: "production",
      DATABASE_URL: database.appUrl,
      // Not the people's password, so a load would change their rows.
      DEMO_PASSWORD: "a password production never gets",
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr.trim()).toBe(
      "The demo company never goes into production.",
    );
    expect(await rows()).toEqual(before);
  });

  it("says what failed by its kind and code, never its message", () => {
    // A database that isn't there fails the first query.
    const result = run({
      DATABASE_URL: database.appUrl.replace(/\/[^/]*$/, "/no_such_demo_db"),
      DEMO_PASSWORD: password,
    });
    expect(result.status).toBe(1);
    expect(result.stderr.trim()).toMatch(
      /^Loading Honeycomb Design Studio \(demo\) failed \(\w+, code 3D000\)\. Its message stays out of the log, since it can hold a password hash\.$/,
    );
    expect(result.stderr).not.toContain("no_such_demo_db");
  });
});
