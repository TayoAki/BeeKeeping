// Agents and API tokens: what admins can do with them, what a token
// unlocks, and the rules the registry holds an agent to.
import { randomUUID } from "node:crypto";

import {
  apiTokens,
  openDatabase,
  organizationSettings,
  type DatabaseHandle,
} from "@beekeeping/db";
import {
  createTestDatabase,
  racing,
  type TestDatabase,
} from "@beekeeping/db/testing";
import { ok, tokens } from "@beekeeping/services";
import { asOwner, demoMember } from "@beekeeping/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { agentScopes } from "../access/agents.ts";
import type { Role } from "../access/roles.ts";
import {
  DatabaseRefusal,
  runAction,
  type AgentPrincipal,
  type Principal,
} from "../context.ts";
import {
  actionKinds,
  approvalsFor,
  defineAction,
  type ActionKind,
  type ApprovalCategory,
} from "../registry/define.ts";
import { invokeAction, invokeDefinition } from "../registry/registry.ts";
import { issueToken, makeAgent } from "../testing/agents.ts";
import { authenticateApiToken } from "./authenticate.ts";

let database: TestDatabase;
let app: DatabaseHandle;

beforeAll(async () => {
  database = await createTestDatabase();
  app = openDatabase(database.appUrl);
});
afterAll(async () => {
  await app.close();
  await database.drop();
});

/**
 * A POSIX time zone whose clocks go forward an hour ten days from now, so
 * any 30 days from now cross the change.
 */
function clocksChangeSoon(): string {
  const now = new Date();
  const today =
    Math.floor(
      (now.getTime() - Date.UTC(now.getUTCFullYear(), 0, 1)) / 86_400_000,
    ) + 1;
  // POSIX numbers the days J1 to J365, skipping 29 February.
  const day = (n: number) => ((n - 1) % 365) + 1;
  return `AAA0BBB,J${day(today + 10)},J${day(today + 100)}`;
}

describe("an organization's admins", () => {
  it("make an agent and a token, which acts as that agent in that organization", async () => {
    const owner = await demoMember(database.url, "agentmaker", "owner");
    const { agent, token, apiToken, principal } = await makeAgent(
      app.db,
      owner,
    );
    expect(agent).toMatchObject({
      name: "Bill runner (demo)",
      role: "bookkeeper",
      scope: "draft",
      revokedAt: null,
    });
    expect(token).toMatch(/^bk_[A-Za-z0-9_-]{43}$/);
    expect(apiToken).toMatchObject({
      prefix: token.slice(0, 10),
      expiresAt: null,
      lastUsedAt: null,
      revokedAt: null,
    });
    expect(await authenticateApiToken(app.db, token)).toEqual(principal);
  });

  it("keep only the token's hash, and list tokens by their first characters", async () => {
    const owner = await demoMember(database.url, "agenthash", "owner");
    const { token, apiToken } = await makeAgent(app.db, owner);
    const stored = await asOwner<{ token_hash: string }>(
      database.url,
      "select token_hash from api_tokens where id = $1",
      [apiToken.id],
    );
    expect(stored).toHaveLength(1);
    expect(stored[0]?.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored[0]?.token_hash).not.toContain(token.slice(3));
    const listed = await invokeAction(app.db, owner, "list_agents", {});
    expect(JSON.stringify(listed)).not.toContain(token);
    expect(JSON.stringify(listed)).not.toContain(stored[0]?.token_hash);
    expect(listed).toMatchObject({
      ok: true,
      agents: [{ tokens: [{ id: apiToken.id, prefix: apiToken.prefix }] }],
    });
  });

  it("give each working agent a name of its own", async () => {
    const owner = await demoMember(database.url, "agentnames", "owner");
    await makeAgent(app.db, owner);
    expect(
      await invokeAction(app.db, owner, "create_agent", {
        name: "  BILL RUNNER (demo) ",
        role: "viewer",
        scope: "read",
      }),
    ).toMatchObject({ ok: false, reason: "name_taken" });
  });

  it("revoke a token, and it stops working at once", async () => {
    const owner = await demoMember(database.url, "tokenrevoke", "owner");
    const { token, apiToken } = await makeAgent(app.db, owner);
    expect(
      await invokeAction(app.db, owner, "revoke_api_token", {
        tokenId: apiToken.id,
      }),
    ).toEqual({ ok: true });
    expect(await authenticateApiToken(app.db, token)).toBeUndefined();
    // Again changes nothing.
    expect(
      await invokeAction(app.db, owner, "revoke_api_token", {
        tokenId: apiToken.id,
      }),
    ).toEqual({ ok: true });
  });

  it("revoke an agent, which ends its tokens and frees its name", async () => {
    const owner = await demoMember(database.url, "agentrevoke", "owner");
    const { agent, token } = await makeAgent(app.db, owner);
    const second = await issueToken(app.db, owner, agent.id);
    expect(
      await invokeAction(app.db, owner, "revoke_agent", { agentId: agent.id }),
    ).toEqual({ ok: true });
    expect(await authenticateApiToken(app.db, token)).toBeUndefined();
    expect(await authenticateApiToken(app.db, second.token)).toBeUndefined();
    expect(
      await invokeAction(app.db, owner, "create_api_token", {
        agentId: agent.id,
      }),
    ).toMatchObject({ ok: false, reason: "not_found" });
    const listed = await invokeAction(app.db, owner, "list_agents", {});
    expect(listed).toMatchObject({
      ok: true,
      agents: [
        {
          id: agent.id,
          revokedAt: expect.any(String) as string,
          tokens: [
            { revokedAt: expect.any(String) as string },
            { revokedAt: expect.any(String) as string },
          ],
        },
      ],
    });
    // Its name can go to a new agent.
    expect(
      await invokeAction(app.db, owner, "create_agent", {
        name: "Bill runner (demo)",
        role: "viewer",
        scope: "read",
      }),
    ).toMatchObject({ ok: true });
  });

  it("revoke once, however many revokes land at the same moment", async () => {
    const owner = await demoMember(database.url, "revokerace", "owner");
    const { agent, apiToken } = await makeAgent(app.db, owner);
    expect(
      await racing(
        database.url,
        [
          [
            "update api_tokens set revoked_at = now() where id = $1",
            [apiToken.id],
          ],
        ],
        () =>
          invokeAction(app.db, owner, "revoke_api_token", {
            tokenId: apiToken.id,
          }),
      ),
    ).toEqual({ ok: true });
    expect(
      await racing(
        database.url,
        [["update agents set revoked_at = now() where id = $1", [agent.id]]],
        () =>
          invokeAction(app.db, owner, "revoke_agent", { agentId: agent.id }),
      ),
    ).toEqual({ ok: true });
  });

  it("never leave a working token under a revoked agent", async () => {
    const owner = await demoMember(database.url, "tokenrace", "owner");
    const { agent } = await makeAgent(app.db, owner);
    // A token asked for while revoke_agent runs waits for it, then finds
    // the agent revoked.
    expect(
      await racing(
        database.url,
        [
          ["update agents set revoked_at = now() where id = $1", [agent.id]],
          [
            "update api_tokens set revoked_at = now() where agent_id = $1 and revoked_at is null",
            [agent.id],
          ],
        ],
        () =>
          invokeAction(app.db, owner, "create_api_token", {
            agentId: agent.id,
          }),
      ),
    ).toMatchObject({ ok: false, reason: "not_found" });
    expect(
      await asOwner(
        database.url,
        "select id from api_tokens where agent_id = $1 and revoked_at is null",
        [agent.id],
      ),
    ).toEqual([]);
  });

  it("give a token an expiry, after which it stops working", async () => {
    const owner = await demoMember(database.url, "tokenexpiry", "owner");
    const { agent } = await makeAgent(app.db, owner);
    const issued = await issueToken(app.db, owner, agent.id, 30);
    const days =
      (Date.parse(issued.apiToken.expiresAt ?? "") -
        Date.parse(issued.apiToken.createdAt)) /
      86_400_000;
    expect(days).toBe(30);
    expect(await authenticateApiToken(app.db, issued.token)).toBeDefined();
    // As if 31 days went by.
    await asOwner(
      database.url,
      "update api_tokens set created_at = created_at - interval '31 days', expires_at = expires_at - interval '31 days' where id = $1",
      [issued.apiToken.id],
    );
    expect(await authenticateApiToken(app.db, issued.token)).toBeUndefined();
  });

  it("count a token's days as 24 hours each, however the clocks change", async () => {
    const owner = await demoMember(database.url, "tokenclocks", "owner");
    const { agent } = await makeAgent(app.db, owner);
    const url = new URL(database.appUrl);
    url.searchParams.set("options", `-c TimeZone=${clocksChangeSoon()}`);
    const shifted = openDatabase(url.toString());
    try {
      const issued = await issueToken(shifted.db, owner, agent.id, 30);
      expect(
        Date.parse(issued.apiToken.expiresAt ?? "") -
          Date.parse(issued.apiToken.createdAt),
      ).toBe(30 * 86_400_000);
    } finally {
      await shifted.close();
    }
  });

  it("are the only ones who may: bookkeepers and viewers are refused", async () => {
    const owner = await demoMember(database.url, "agentroles", "owner");
    const { agent, apiToken } = await makeAgent(app.db, owner);
    for (const role of ["bookkeeper", "viewer"] as const) {
      const member: Principal = { ...owner, role };
      for (const [name, input] of [
        ["create_agent", { name: "Other", role: "viewer", scope: "read" }],
        ["create_api_token", { agentId: agent.id }],
        ["list_agents", {}],
        ["revoke_api_token", { tokenId: apiToken.id }],
        ["revoke_agent", { agentId: agent.id }],
      ] as const) {
        expect(
          await invokeAction(app.db, member, name, input),
          `${role} ${name}`,
        ).toMatchObject({ ok: false, reason: "forbidden" });
      }
    }
  });

  it("can't make an owner agent or an unknown scope", async () => {
    const owner = await demoMember(database.url, "agentinput", "owner");
    for (const input of [
      { name: "Owner (demo)", role: "owner", scope: "read" },
      { name: "Wide (demo)", role: "viewer", scope: "admin" },
      { name: " ", role: "viewer", scope: "read" },
      { name: "x".repeat(81), role: "viewer", scope: "read" },
    ]) {
      expect(
        await invokeAction(app.db, owner, "create_agent", input),
      ).toMatchObject({ ok: false, reason: "invalid_input" });
    }
    for (const expiresInDays of [0, 366, 1.5]) {
      expect(
        await invokeAction(app.db, owner, "create_api_token", {
          agentId: randomUUID(),
          expiresInDays,
        }),
      ).toMatchObject({ ok: false, reason: "invalid_input" });
    }
  });

  it("can still have their account deleted once an agent they made is revoked", async () => {
    const owner = await demoMember(database.url, "agentleaver", "owner");
    const { agent } = await makeAgent(app.db, owner);
    await invokeAction(app.db, owner, "revoke_agent", { agentId: agent.id });
    await asOwner(database.url, "delete from users where id = $1", [
      owner.userId,
    ]);
    expect(
      await asOwner(database.url, "select id from users where id = $1", [
        owner.userId,
      ]),
    ).toEqual([]);
  });
});

describe("authenticateApiToken", () => {
  it("answers nothing for text that isn't a working token", async () => {
    const owner = await demoMember(database.url, "authnothing", "owner");
    const { token } = await makeAgent(app.db, owner);
    for (const presented of [
      "",
      "not a token",
      token.slice(0, -1),
      `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`,
      token.toUpperCase(),
    ]) {
      expect(await authenticateApiToken(app.db, presented)).toBeUndefined();
    }
  });

  it("notes a token's use at most once a minute, and logs no event for it", async () => {
    const owner = await demoMember(database.url, "authused", "owner");
    const { token, apiToken } = await makeAgent(app.db, owner);
    const lastUsed = async () =>
      (
        await asOwner<{ last_used_at: Date | null }>(
          database.url,
          "select last_used_at from api_tokens where id = $1",
          [apiToken.id],
        )
      )[0]?.last_used_at;
    const events = () =>
      asOwner(database.url, "select 1 from audit_events where org_id = $1", [
        owner.orgId,
      ]);
    const eventsBefore = await events();
    await authenticateApiToken(app.db, token);
    const first = await lastUsed();
    expect(first).toBeInstanceOf(Date);
    await authenticateApiToken(app.db, token);
    expect(await lastUsed()).toEqual(first);
    await asOwner(
      database.url,
      "update api_tokens set last_used_at = last_used_at - interval '2 minutes' where id = $1",
      [apiToken.id],
    );
    await authenticateApiToken(app.db, token);
    expect((await lastUsed())?.getTime()).toBeGreaterThan(
      first?.getTime() ?? 0,
    );
    expect(await events()).toHaveLength(eventsBefore.length);
  });

  it("fails with the database's code alone, never the hash, when the lookup is refused", async () => {
    const owner = await demoMember(database.url, "authrefused", "owner");
    const { token } = await makeAgent(app.db, owner);
    const hashed = tokens.apiTokenHash(token);
    if (!hashed.ok) throw new Error("The token has no hash.");
    // Better Auth's role may not call the lookup.
    const signIn = openDatabase(database.appUrl, { role: "auth" });
    try {
      const error = await authenticateApiToken(signIn.db, token).then(
        () => undefined,
        (thrown: unknown) => thrown,
      );
      expect(error).toBeInstanceOf(DatabaseRefusal);
      expect(error).toMatchObject({ code: "42501" });
      const told = `${String(error)} ${(error as Error).stack} ${JSON.stringify(error)}`;
      expect(told).not.toContain(hashed.hash);
    } finally {
      await signIn.close();
    }
  });
});

describe("an agent's calls", () => {
  // A stand-in for each kind and approval category, which writes the
  // caller's settings row so the log shows who wrote it.
  const standIn = (
    kind: ActionKind,
    approval: ApprovalCategory,
    role: Role = "viewer",
  ) =>
    defineAction({
      name: `stand_in_${kind}_${approval}`,
      description: "Writes the caller's settings row.",
      kind,
      role,
      approval,
      input: z.object({ note: z.string().optional() }),
      output: z.object({}),
      run: async (ctx) => {
        await ctx.tx
          .insert(organizationSettings)
          .values({ orgId: ctx.orgId, homeCurrency: "USD" })
          .onConflictDoNothing();
        return ok({});
      },
    });

  it("reach the kinds their scope allows, never admin, and wait for approval on a post", async () => {
    const owner = await demoMember(database.url, "agentmatrix", "owner");
    const answers: string[] = [];
    for (const scope of agentScopes) {
      const { principal } = await makeAgent(app.db, owner, {
        name: `Agent that may ${scope} (demo)`,
        role: "admin",
        scope,
      });
      for (const kind of actionKinds) {
        for (const approval of approvalsFor[kind]) {
          const outcome = await invokeDefinition(
            app.db,
            principal,
            standIn(kind, approval),
            {},
          );
          answers.push(
            `${scope} ${kind} ${approval}: ${outcome.ok ? "ok" : outcome.reason}`,
          );
        }
      }
    }
    expect(answers).toEqual([
      "read read none: ok",
      "read draft none: forbidden",
      "read post policy: forbidden",
      "read post ask: forbidden",
      "read post never: forbidden",
      "read admin never: forbidden",
      "draft read none: ok",
      "draft draft none: ok",
      "draft post policy: forbidden",
      "draft post ask: forbidden",
      "draft post never: forbidden",
      "draft admin never: forbidden",
      "post read none: ok",
      "post draft none: ok",
      "post post policy: approval_required",
      "post post ask: approval_required",
      "post post never: forbidden",
      "post admin never: forbidden",
    ]);
  });

  it("run a post once a person approved it, and the log names both", async () => {
    const owner = await demoMember(database.url, "agentapproved", "owner");
    const { principal } = await makeAgent(app.db, owner, { scope: "post" });
    expect(
      await invokeDefinition(
        app.db,
        { ...principal, approvedBy: owner.userId },
        standIn("post", "ask"),
        {},
      ),
    ).toEqual({ ok: true });
    expect(
      await asOwner(
        database.url,
        "select actor_user_id, actor_agent_id, approved_by_user_id from audit_events where org_id = $1 and table_name = 'organization_settings'",
        [owner.orgId],
      ),
    ).toEqual([
      {
        actor_user_id: null,
        actor_agent_id: principal.agentId,
        approved_by_user_id: owner.userId,
      },
    ]);
  });

  it("wait for approval when the approver is empty, and only once the input is right", async () => {
    const owner = await demoMember(database.url, "agentwaits", "owner");
    const { principal } = await makeAgent(app.db, owner, { scope: "post" });
    const post = standIn("post", "ask");
    expect(
      await invokeDefinition(
        app.db,
        { ...principal, approvedBy: "" },
        post,
        {},
      ),
    ).toMatchObject({ ok: false, reason: "approval_required" });
    expect(
      await invokeDefinition(app.db, principal, post, { note: 5 }),
    ).toMatchObject({ ok: false, reason: "invalid_input" });
  });

  it("are held to the agent's role, as a member's are", async () => {
    const owner = await demoMember(database.url, "agentrole", "owner");
    const { principal } = await makeAgent(app.db, owner, {
      role: "viewer",
      scope: "post",
    });
    expect(
      await invokeDefinition(
        app.db,
        principal,
        standIn("read", "none", "bookkeeper"),
        {},
      ),
    ).toMatchObject({ ok: false, reason: "forbidden" });
    expect(
      await invokeAction(app.db, principal, "get_organization_settings", {}),
    ).toMatchObject({ ok: false, reason: "not_found" });
  });

  it("never read the audit log, which copies agents and tokens", async () => {
    const owner = await demoMember(database.url, "agentlog", "owner");
    const { principal } = await makeAgent(app.db, owner, {
      role: "admin",
      scope: "read",
    });
    expect(
      await invokeAction(app.db, principal, "list_audit_events", {}),
    ).toMatchObject({ ok: false, reason: "forbidden" });
  });

  it("stop once the agent is revoked, and never run for an agent the organization doesn't have", async () => {
    const owner = await demoMember(database.url, "agentgone", "owner");
    const other = await demoMember(database.url, "agentelsewhere", "owner");
    const { agent, principal } = await makeAgent(app.db, owner);
    const draft = standIn("draft", "none");
    expect(await invokeDefinition(app.db, principal, draft, {})).toEqual({
      ok: true,
    });
    // The role and the scope are checked each on its own.
    const strangers: AgentPrincipal[] = [
      { ...principal, agentId: randomUUID() },
      { ...principal, role: "admin" },
      { ...principal, scope: "post" },
      { ...principal, orgId: other.orgId },
    ];
    for (const stranger of strangers) {
      expect(await invokeDefinition(app.db, stranger, draft, {})).toMatchObject(
        { ok: false, reason: "forbidden" },
      );
    }
    await invokeAction(app.db, owner, "revoke_agent", { agentId: agent.id });
    expect(await invokeDefinition(app.db, principal, draft, {})).toMatchObject({
      ok: false,
      reason: "forbidden",
    });
  });

  it("answer forbidden, not approval_required, for an agent the database doesn't back", async () => {
    const owner = await demoMember(database.url, "agentunbacked", "owner");
    const { agent, principal } = await makeAgent(app.db, owner, {
      scope: "post",
    });
    const post = standIn("post", "ask");
    await invokeAction(app.db, owner, "revoke_agent", { agentId: agent.id });
    for (const unbacked of [
      principal,
      { ...principal, agentId: randomUUID() },
    ] satisfies AgentPrincipal[]) {
      expect(await invokeDefinition(app.db, unbacked, post, {})).toMatchObject({
        ok: false,
        reason: "forbidden",
      });
    }
  });

  it("show in the log who acted, who approved, and the agents' names", async () => {
    const owner = await demoMember(database.url, "agentnamed", "owner");
    const { agent, principal } = await makeAgent(app.db, owner, {
      scope: "post",
    });
    await invokeDefinition(
      app.db,
      { ...principal, approvedBy: owner.userId },
      standIn("post", "ask"),
      {},
    );
    const listed = await invokeAction(app.db, owner, "list_audit_events", {});
    expect(listed).toMatchObject({
      ok: true,
      agents: [{ id: agent.id, name: agent.name }],
    });
    expect(
      listed.ok &&
        listed.events.find(
          (event) => event.tableName === "organization_settings",
        ),
    ).toMatchObject({
      actorUserId: null,
      actorAgentId: agent.id,
      approvedByUserId: owner.userId,
    });
    // A token's event names its agent, though no agent acted.
    expect(
      await invokeAction(app.db, owner, "list_audit_events", {
        table: "api_tokens",
      }),
    ).toMatchObject({ ok: true, agents: [{ id: agent.id }] });
  });

  it("never see or touch agents or tokens, even past the registry", async () => {
    const owner = await demoMember(database.url, "agenthidden", "owner");
    const { agent, principal } = await makeAgent(app.db, owner, {
      scope: "post",
    });
    const outcome = await runAction(app.db, principal, async (ctx) => {
      const agentRows = await ctx.tx.execute(sql`select id from agents`);
      const tokenRows = await ctx.tx
        .select({ id: apiTokens.id })
        .from(apiTokens);
      return { agents: agentRows.rows, tokens: tokenRows };
    });
    expect(outcome).toEqual({ agents: [], tokens: [] });
    await expect(
      runAction(app.db, principal, (ctx) =>
        ctx.tx.execute(
          sql`insert into agents (org_id, name, role, scope) values (${owner.orgId}, 'Sneaky (demo)', 'admin', 'post')`,
        ),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      runAction(app.db, principal, (ctx) =>
        ctx.tx.execute(
          sql`update agents set revoked_at = now() where id = ${agent.id}`,
        ),
      ),
    ).resolves.toMatchObject({ rowCount: 0 });
  });
});
