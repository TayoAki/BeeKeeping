import { beforeEach, describe, expect, it, vi } from "vitest";

// runForMember builds the principal from the session and the membership.
// Both, the pool and runAction are stood in for here, so each test decides
// what the session holds and sees what runAction gets.
const session = { requireSignedIn: vi.fn(), activeMembership: vi.fn() };
const runAction = vi.fn();
const db = { pool: "the app's pool" };
vi.mock("./session.ts", () => session);
vi.mock("./database.ts", () => ({ database: () => ({ db }) }));
vi.mock("@beekeeping/actions", () => ({ runAction }));

const { runForMember } = await import("./actions.ts");

const userId = "0c0c0c0c-0000-4000-8000-000000000001";
const orgId = "0b0b0b0b-0000-4000-8000-000000000001";

beforeEach(() => {
  session.requireSignedIn.mockReset();
  session.activeMembership.mockReset();
  runAction.mockReset();
  session.requireSignedIn.mockResolvedValue({ user: { id: userId } });
});

describe("runForMember", () => {
  it("acts for the signed-in person, in their active organization and role", async () => {
    session.activeMembership.mockResolvedValue({
      organizationId: orgId,
      organizationName: "Honeycomb Design Studio (demo)",
      role: "bookkeeper",
    });
    runAction.mockResolvedValue({ ok: true });
    const action = vi.fn();
    expect(await runForMember(action)).toEqual({ ok: true });
    expect(runAction).toHaveBeenCalledExactlyOnceWith(
      db,
      { orgId, userId, role: "bookkeeper" },
      action,
    );
  });

  it("answers no_organization, and runs nothing, without a membership", async () => {
    session.activeMembership.mockResolvedValue(undefined);
    expect(await runForMember(vi.fn())).toEqual({
      ok: false,
      reason: "no_organization",
      message: "Choose an organization first.",
    });
    expect(runAction).not.toHaveBeenCalled();
  });
});
