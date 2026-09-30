// Agents and API tokens in the database: what the app may do with them,
// the two functions that run past row-level security, and what the audit
// log records about them and about an agent's changes.
import { randomUUID } from "node:crypto";

import { tokens } from "@beekeeping/services";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { asApp, type AppSettings } from "./testing/as-app.ts";
import {
  createTestDatabase,
  postgresError,
  racing,
  type TestDatabase,
} from "./testing/test-database.ts";

let database: TestDatabase;
let owner: pg.Client;
let app: pg.Client;

beforeAll(async () => {
  database = await createTestDatabase();
  owner = new pg.Client({ connectionString: database.url });
  await owner.connect();
  app = new pg.Client({ connectionString: database.appUrl });
  await app.connect();
});
afterAll(async () => {
  await app.end();
  await owner.end();
  await database.drop();
});

/** An organization with an agent and a token, made by one of its people. */
async function organizationWithAgent() {
  const orgId = randomUUID();
  const userId = randomUUID();
  await owner.query(
    "insert into organizations (id, name, slug) values ($1, 'Agents Studio (demo)', $2)",
    [orgId, `agents-${orgId}`],
  );
  const as = { orgId, userId };
  const agent = await asApp(
    app,
    as,
    "insert into agents (org_id, name, role, scope) values ($1, 'Bill runner (demo)', 'bookkeeper', 'draft') returning id",
    [orgId],
  );
  const agentId = (agent.rows[0] as { id: string }).id;
  const { hash, prefix } = tokens.newApiToken();
  const token = await asApp(
    app,
    as,
    "insert into api_tokens (org_id, agent_id, token_hash, prefix) values ($1, $2, $3, $4) returning id",
    [orgId, agentId, hash, prefix],
  );
  const tokenId = (token.rows[0] as { id: string }).id;
  return { orgId, userId, agentId, tokenId, hash, as };
}

/** What authenticate_api_token answers the app for a hash. */
async function authenticate(hash: string) {
  return (
    await asApp<{
      org_id: string;
      agent_id: string;
      role: string;
      scope: string;
    }>(
      app,
      {},
      "select org_id, agent_id, role, scope from authenticate_api_token($1)",
      [hash],
    )
  ).rows;
}

/** What working_agent answers a transaction with these settings. */
async function working(settings: AppSettings) {
  return (
    await asApp<{ role: string; scope: string }>(
      app,
      settings,
      "select role, scope from working_agent()",
    )
  ).rows;
}

describe("authenticate_api_token", () => {
  it("answers a working token's organization, agent, role and scope, and nothing else", async () => {
    const made = await organizationWithAgent();
    expect(await authenticate(made.hash)).toEqual([
      {
        org_id: made.orgId,
        agent_id: made.agentId,
        role: "bookkeeper",
        scope: "draft",
      },
    ]);
    expect(await authenticate(tokens.newApiToken().hash)).toEqual([]);
  });

  it("answers nothing once the token or its agent is revoked, or the token expires", async () => {
    for (const [end, id] of [
      ["update api_tokens set revoked_at = now() where id = $1", "tokenId"],
      ["update agents set revoked_at = now() where id = $1", "agentId"],
      [
        "update api_tokens set created_at = now() - interval '2 days', expires_at = now() - interval '1 day' where id = $1",
        "tokenId",
      ],
    ] as const) {
      const made = await organizationWithAgent();
      await owner.query(end, [made[id]]);
      expect(await authenticate(made.hash), end).toEqual([]);
    }
  });

  it("still answers, and leaves the token be, when a revoke lands while it notes the use", async () => {
    const made = await organizationWithAgent();
    // It began before the revoke committed, so it answers as it found the
    // token. The revoke stands.
    const answer = await racing(
      database.url,
      [
        [
          "update api_tokens set revoked_at = now() where id = $1",
          [made.tokenId],
        ],
      ],
      () => authenticate(made.hash),
    );
    expect(answer).toHaveLength(1);
    expect(await authenticate(made.hash)).toEqual([]);
  });
});

describe("working_agent", () => {
  it("answers the acting agent's role and scope while it works, and nothing otherwise", async () => {
    const made = await organizationWithAgent();
    const other = await organizationWithAgent();
    const acting = { orgId: made.orgId, agentId: made.agentId };
    expect(await working(acting)).toEqual([
      { role: "bookkeeper", scope: "draft" },
    ]);
    for (const settings of [
      made.as,
      { orgId: made.orgId, agentId: other.agentId },
      { orgId: made.orgId, agentId: randomUUID() },
    ]) {
      expect(await working(settings)).toEqual([]);
    }
    await owner.query("update agents set revoked_at = now() where id = $1", [
      made.agentId,
    ]);
    expect(await working(acting)).toEqual([]);
  });
});

describe("working_agent's lock", () => {
  it("lasts until the agent's call commits, so a revoke waits for calls in flight", async () => {
    const made = await organizationWithAgent();
    // Another transaction is the agent's call, past its check.
    await racing(
      database.url,
      [
        ["set local role beekeeping_app", []],
        [
          "select set_config('app.org_id', $1, true), set_config('app.agent_id', $2, true)",
          [made.orgId, made.agentId],
        ],
        ["select * from working_agent()", []],
      ],
      () =>
        asApp(
          app,
          made.as,
          "update agents set revoked_at = now() where id = $1",
          [made.agentId],
        ),
    );
    expect(await working({ orgId: made.orgId, agentId: made.agentId })).toEqual(
      [],
    );
  });
});

describe("the functions that run past row-level security", () => {
  it("may be called by the app's role only", async () => {
    const made = await organizationWithAgent();
    for (const role of ["beekeeping_auth", "none"]) {
      for (const [call, values] of [
        ["select * from authenticate_api_token($1)", [made.hash]],
        ["select * from working_agent()", []],
      ] as const) {
        const error = await postgresError(
          (async () => {
            await app.query("begin");
            try {
              await app.query(`set local role ${role}`);
              await app.query(call, [...values]);
            } finally {
              await app.query("rollback");
            }
          })(),
        );
        expect(error.code, `${role}: ${call}`).toBe("42501");
      }
    }
  });
});

describe("agents and tokens", () => {
  it("can't be deleted, and nothing but revoked_at changes", async () => {
    const made = await organizationWithAgent();
    for (const statement of [
      "delete from agents",
      "delete from api_tokens",
      "update agents set role = 'admin'",
      "update agents set scope = 'post'",
      "update agents set name = 'Renamed (demo)'",
      `update api_tokens set token_hash = '${"0".repeat(64)}'`,
      "update api_tokens set expires_at = null",
      "update api_tokens set last_used_at = now()",
    ]) {
      const error = await postgresError(asApp(app, made.as, statement));
      expect(error.code, statement).toBe("42501");
    }
    await asApp(app, made.as, "update api_tokens set revoked_at = now()");
    await asApp(app, made.as, "update agents set revoked_at = now()");
  });

  it("stay revoked, whoever tries to change them", async () => {
    const made = await organizationWithAgent();
    await asApp(app, made.as, "update agents set revoked_at = now()");
    await asApp(app, made.as, "update api_tokens set revoked_at = now()");
    for (const run of [
      () => asApp(app, made.as, "update agents set revoked_at = null"),
      () => asApp(app, made.as, "update api_tokens set revoked_at = null"),
      () =>
        owner.query("update agents set revoked_at = null where id = $1", [
          made.agentId,
        ]),
      () =>
        owner.query("update api_tokens set expires_at = null where id = $1", [
          made.tokenId,
        ]),
    ]) {
      const error = await postgresError(run());
      expect(error).toMatchObject({
        code: "42501",
        message: expect.stringMatching(
          /^A revoked row in \w+ never changes\.$/,
        ) as string,
      });
    }
  });

  it("keep a token's hash from the app, which reads every other field", async () => {
    const made = await organizationWithAgent();
    const error = await postgresError(
      asApp(app, made.as, "select token_hash from api_tokens"),
    );
    expect(error.code).toBe("42501");
    const { rows } = await asApp(
      app,
      made.as,
      "select id, org_id, agent_id, prefix, created_at, expires_at, last_used_at, revoked_at from api_tokens",
    );
    expect(rows).toMatchObject([{ id: made.tokenId }]);
  });

  it("keep a token in its agent's organization", async () => {
    const one = await organizationWithAgent();
    const other = await organizationWithAgent();
    const { hash, prefix } = tokens.newApiToken();
    // The row is the other organization's, as far as row-level security
    // knows, but the agent is this one's.
    const error = await postgresError(
      asApp(
        app,
        other.as,
        "insert into api_tokens (org_id, agent_id, token_hash, prefix) values ($1, $2, $3, $4)",
        [other.orgId, one.agentId, hash, prefix],
      ),
    );
    expect(error.code).toBe("23503");
  });

  it("never hold an owner agent, an unknown scope or a token that isn't a hash", async () => {
    const made = await organizationWithAgent();
    for (const [statement, values] of [
      [
        "insert into agents (org_id, name, role, scope) values ($1, 'Boss (demo)', 'owner', 'read')",
        [made.orgId],
      ],
      [
        "insert into agents (org_id, name, role, scope) values ($1, 'Wide (demo)', 'viewer', 'admin')",
        [made.orgId],
      ],
      [
        "insert into agents (org_id, name, role, scope) values ($1, '   ', 'viewer', 'read')",
        [made.orgId],
      ],
      [
        "insert into api_tokens (org_id, agent_id, token_hash, prefix) values ($1, $2, 'bk_the-token-itself', 'bk_abcdefg')",
        [made.orgId, made.agentId],
      ],
    ] as const) {
      const error = await postgresError(
        asApp(app, made.as, statement, [...values]),
      );
      expect(error.code, statement).toBe("23514");
    }
  });
});

describe("the audit log", () => {
  it("names the agent and the person who approved, and no person, for an agent's change", async () => {
    const made = await organizationWithAgent();
    await asApp(
      app,
      { orgId: made.orgId, agentId: made.agentId, approverId: made.userId },
      "insert into organization_settings (org_id, home_currency) values ($1, 'EUR')",
      [made.orgId],
    );
    const { rows } = await owner.query(
      `select actor_user_id, actor_agent_id, approved_by_user_id from audit_events
        where org_id = $1 and table_name = 'organization_settings'`,
      [made.orgId],
    );
    expect(rows).toEqual([
      {
        actor_user_id: null,
        actor_agent_id: made.agentId,
        approved_by_user_id: made.userId,
      },
    ]);
  });

  it("records who made and revoked agents and tokens, and never a token's hash", async () => {
    const made = await organizationWithAgent();
    await asApp(app, made.as, "update api_tokens set revoked_at = now()");
    const { rows } = await owner.query<{
      table_name: string;
      action: string;
      actor_user_id: string;
      changes: Record<string, unknown>;
    }>(
      `select table_name, action, actor_user_id, changes from audit_events
        where org_id = $1 order by seq`,
      [made.orgId],
    );
    expect(
      rows.map(({ table_name, action }) => `${table_name} ${action}`),
    ).toEqual(["agents insert", "api_tokens insert", "api_tokens update"]);
    expect(rows.map(({ actor_user_id }) => actor_user_id)).toEqual([
      made.userId,
      made.userId,
      made.userId,
    ]);
    // The key, id, is the event's record_id; the rest are the listed fields.
    expect(Object.keys(rows[1]?.changes ?? {}).sort()).toEqual([
      "agent_id",
      "expires_at",
      "prefix",
      "revoked_at",
    ]);
    expect(JSON.stringify(rows)).not.toContain(made.hash);
  });
});
