import { beforeEach, describe, expect, it, vi } from "vitest";

// invokeForMember builds the principal from the session and the membership.
// Both, the pool and invokeAction are stood in for here, so each test
// decides what the session holds and sees what invokeAction gets.
const session = { requireSignedIn: vi.fn(), activeMembership: vi.fn() };
const invokeAction = vi.fn();
const db = { pool: "the app's pool" };
vi.mock("./session.ts", () => session);
vi.mock("./database.ts", () => ({ database: () => ({ db }) }));
vi.mock("@beekeeping/actions", () => ({ invokeAction }));

const { invokeForMember } = await import("./actions.ts");

const userId = "0c0c0c0c-0000-4000-8000-000000000001";
const orgId = "0b0b0b0b-0000-4000-8000-000000000001";

beforeEach(() => {
  session.requireSignedIn.mockReset();
  session.activeMembership.mockReset();
  invokeAction.mockReset();
  session.requireSignedIn.mockResolvedValue({ user: { id: userId } });
});

describe("invokeForMember", () => {
  it("acts for the signed-in person, in their active organization and role", async () => {
    session.activeMembership.mockResolvedValue({
      organizationId: orgId,
      organizationName: "Honeycomb Design Studio (demo)",
      role: "bookkeeper",
    });
    invokeAction.mockResolvedValue({ ok: true });
    const input = { homeCurrency: "USD" };
    expect(await invokeForMember("set_up_organization", input)).toEqual({
      ok: true,
    });
    expect(invokeAction).toHaveBeenCalledExactlyOnceWith(
      db,
      { kind: "person", orgId, userId, role: "bookkeeper" },
      "set_up_organization",
      input,
    );
  });

  it("answers no_organization, and calls nothing, without a membership", async () => {
    session.activeMembership.mockResolvedValue(undefined);
    expect(await invokeForMember("get_organization_settings", {})).toEqual({
      ok: false,
      reason: "no_organization",
      message: "Choose an organization first.",
    });
    expect(invokeAction).not.toHaveBeenCalled();
  });
});
