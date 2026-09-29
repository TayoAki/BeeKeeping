import { organizationSettings } from "@beekeeping/db";
import { fail, money, ok, type Result } from "@beekeeping/services";
import { eq } from "drizzle-orm";

import { roleAtLeast } from "../access/roles.ts";
import type { ActionContext } from "../context.ts";

export type OrganizationSettings = { readonly homeCurrency: string };

type Message = { message: string };

/**
 * Records what an organization sets once, when it's created: the currency
 * its books are kept in. Only the owner sets it, and it never changes.
 */
export async function setUpOrganization(
  ctx: ActionContext,
  input: { readonly homeCurrency: string },
): Promise<
  Result<
    { settings: OrganizationSettings },
    "forbidden" | "unknown_currency" | "already_set_up",
    Message
  >
> {
  if (!roleAtLeast(ctx.role, "owner")) {
    return fail("forbidden", {
      message: "Only the organization's owner can set it up.",
    });
  }
  const parsed = money.parseCurrencyCode(input.homeCurrency);
  if (!parsed.ok) {
    return fail("unknown_currency", {
      message: "Choose a currency from the list.",
    });
  }
  const inserted = await ctx.tx
    .insert(organizationSettings)
    .values({ orgId: ctx.orgId, homeCurrency: parsed.currency })
    .onConflictDoNothing()
    .returning({ orgId: organizationSettings.orgId });
  if (inserted.length === 0) {
    return fail("already_set_up", {
      message:
        "This organization is set up already, and its home currency can't change.",
    });
  }
  return ok({ settings: { homeCurrency: parsed.currency } });
}

/** The organization's settings, or not_found until the owner sets them. */
export async function getOrganizationSettings(
  ctx: ActionContext,
): Promise<Result<{ settings: OrganizationSettings }, "not_found", Message>> {
  const [settings] = await ctx.tx
    .select({ homeCurrency: organizationSettings.homeCurrency })
    .from(organizationSettings)
    .where(eq(organizationSettings.orgId, ctx.orgId));
  return settings
    ? ok({ settings })
    : fail("not_found", { message: "This organization isn't set up yet." });
}
