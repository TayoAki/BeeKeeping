"use server";

import { setUpOrganization } from "@beekeeping/actions";
import { z } from "zod";

import { runForMember } from "../../server/actions.ts";

const input = z.object({ homeCurrency: z.string().trim().min(1) });

export type SetUpState = { ok: true } | { ok: false; message: string };

/** Sets the active organization's home currency, once, for its owner. */
export async function setUpOrganizationAction(
  raw: unknown,
): Promise<SetUpState> {
  const parsed = input.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, message: "Choose a currency from the list." };
  }
  const outcome = await runForMember((ctx) =>
    setUpOrganization(ctx, parsed.data),
  );
  return outcome.ok ? { ok: true } : { ok: false, message: outcome.message };
}
