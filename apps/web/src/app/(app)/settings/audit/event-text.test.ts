import { describe, expect, it } from "vitest";

import {
  actorText,
  changeLines,
  tableName,
  when,
  type Actors,
} from "./event-text.ts";

describe("the audit log page's words", () => {
  const avery = "9d7c1f2e-5b3a-4c8d-9e0f-1a2b3c4d5e6f";
  const leaver = "0f1e2d3c-4b5a-4968-8776-655443322110";
  const billRunner = "5e4d3c2b-1a09-4f8e-8d7c-6b5a49382716";

  const members = new Map([
    [avery, { name: "Avery Park", email: "avery@honeycomb-demo.test" }],
  ]);
  const agents = new Map([[billRunner, "Bill runner (demo)"]]);
  const by = (actors: Partial<Actors>) =>
    actorText(
      {
        actorUserId: null,
        actorAgentId: null,
        approvedByUserId: null,
        ...actors,
      },
      members,
      agents,
    );

  it("names a member by name and address", () => {
    expect(by({ actorUserId: avery })).toEqual({
      name: "Avery Park",
      email: "avery@honeycomb-demo.test",
    });
  });

  it("says BeeKeeping itself when nobody acted", () => {
    expect(by({})).toEqual({ name: "BeeKeeping itself" });
  });

  it("says someone left when the person isn't a member any more", () => {
    expect(by({ actorUserId: leaver })).toEqual({
      name: "Someone no longer in this organization",
    });
  });

  it("names an agent, and the person who approved its change", () => {
    expect(by({ actorAgentId: billRunner })).toEqual({
      name: "Bill runner (demo)",
      detail: "Agent",
    });
    expect(by({ actorAgentId: billRunner, approvedByUserId: avery })).toEqual({
      name: "Bill runner (demo)",
      detail: "Agent, approved by Avery Park",
    });
    expect(by({ actorAgentId: billRunner, approvedByUserId: leaver })).toEqual({
      name: "Bill runner (demo)",
      detail: "Agent, approved by Someone no longer in this organization",
    });
  });

  it("words each kind of change", () => {
    expect(changeLines("insert", { home_currency: "USD" })).toEqual([
      "Home currency: USD",
    ]);
    expect(changeLines("update", { home_currency: ["USD", "EUR"] })).toEqual([
      "Home currency: USD to EUR",
    ]);
    expect(changeLines("delete", { label: null, rate: 0.2 })).toEqual([
      "label: empty",
      "rate: 0.2",
    ]);
  });

  it("words agents and tokens: the agent by name, and moments to the minute in UTC", () => {
    expect(
      changeLines("insert", {
        name: "Bill runner (demo)",
        role: "bookkeeper",
        scope: "draft",
        revoked_at: null,
      }),
    ).toEqual([
      "Name: Bill runner (demo)",
      "Role: bookkeeper",
      "Scope: draft",
      "Revoked: empty",
    ]);
    expect(
      changeLines(
        "insert",
        {
          agent_id: billRunner,
          prefix: "bk_sMOff-B",
          expires_at: "2026-10-30T03:15:20.546123+01:00",
        },
        agents,
      ),
    ).toEqual([
      "Agent: Bill runner (demo)",
      "Starts with: bk_sMOff-B",
      "Expires: 2026-10-30 02:15",
    ]);
    expect(
      changeLines("update", {
        revoked_at: [null, "2026-09-30T02:15:20.546123+00:00"],
      }),
    ).toEqual(["Revoked: empty to 2026-09-30 02:15"]);
  });

  it("names known tables, and shows others as they are", () => {
    expect(tableName("organization_settings")).toBe("Organization settings");
    expect(tableName("vault")).toBe("vault");
  });

  it("shows a moment to the minute, in UTC", () => {
    expect(when("2026-09-29T23:05:12.345Z")).toBe("2026-09-29 23:05");
  });
});
