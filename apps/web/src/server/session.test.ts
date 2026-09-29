import { beforeEach, describe, expect, it, vi } from "vitest";

// activeMembership reads the request's headers and asks Better Auth. Both
// are stood in for here, so each test decides what Better Auth answers.
const api = {
  getActiveMember: vi.fn(),
  getOrganization: vi.fn(),
};
vi.mock("next/headers", () => ({ headers: () => new Headers() }));
vi.mock("./auth.ts", () => ({ getAuth: () => ({ api }) }));

const { activeMembership } = await import("./session.ts");

const orgY = { id: "0b0b0b0b-0000-4000-8000-00000000000y", name: "Y (demo)" };

beforeEach(() => {
  api.getActiveMember.mockReset();
  api.getOrganization.mockReset();
});

describe("activeMembership", () => {
  it("takes the organization and the role from one membership", async () => {
    api.getActiveMember.mockResolvedValue({
      organizationId: orgY.id,
      role: "viewer",
    });
    api.getOrganization.mockResolvedValue(orgY);
    expect(await activeMembership()).toEqual({
      organizationId: orgY.id,
      organizationName: "Y (demo)",
      role: "viewer",
    });
    expect(api.getOrganization).toHaveBeenCalledWith(
      expect.objectContaining({ query: { organizationId: orgY.id } }),
    );
  });

  it("refuses when the organization it finds isn't the membership's", async () => {
    // As if the active organization switched between the two reads.
    api.getActiveMember.mockResolvedValue({
      organizationId: "0b0b0b0b-0000-4000-8000-00000000000x",
      role: "owner",
    });
    api.getOrganization.mockResolvedValue(orgY);
    expect(await activeMembership()).toBeUndefined();
  });

  it("has no membership without an active member or with an unknown role", async () => {
    api.getActiveMember.mockResolvedValue(null);
    expect(await activeMembership()).toBeUndefined();
    api.getActiveMember.mockResolvedValue({
      organizationId: orgY.id,
      role: "superadmin",
    });
    expect(await activeMembership()).toBeUndefined();
  });
});
