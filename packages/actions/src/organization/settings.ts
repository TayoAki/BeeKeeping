import { organizationSettings } from "@beekeeping/db";
import { fail, money, ok } from "@beekeeping/services";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { defineAction } from "../registry/define.ts";

const settingsOutput = z.object({
  settings: z.object({ homeCurrency: z.string() }),
});

export type OrganizationSettings = z.output<typeof settingsOutput>["settings"];

/**
 * Records what an organization sets once, when it's created: the currency
 * its books are kept in. Only the owner sets it, and it never changes.
 */
export const setUpOrganization = defineAction({
  name: "set_up_organization",
  description:
    "Sets the organization's home currency, the one its books are kept in. It's set once, when the organization is created, and never changes.",
  kind: "admin",
  role: "owner",
  approval: "never",
  input: z.object({
    homeCurrency: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{3}$/, "Use a three-letter currency code, such as USD.")
      .describe("An ISO 4217 currency code, such as USD or EUR."),
  }),
  output: settingsOutput,
  run: async (ctx, input) => {
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
  },
});

/** The organization's settings, or not_found until the owner sets them. */
export const getOrganizationSettings = defineAction({
  name: "get_organization_settings",
  description:
    "Reads the organization's settings: its home currency. Answers not_found until the owner sets it up.",
  kind: "read",
  role: "viewer",
  approval: "none",
  input: z.object({}),
  output: settingsOutput,
  run: async (ctx) => {
    const [settings] = await ctx.tx
      .select({ homeCurrency: organizationSettings.homeCurrency })
      .from(organizationSettings)
      .where(eq(organizationSettings.orgId, ctx.orgId));
    return settings
      ? ok({ settings })
      : fail("not_found", { message: "This organization isn't set up yet." });
  },
});
