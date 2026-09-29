import type { Metadata } from "next";
import { getOrganizationSettings, type Role } from "@beekeeping/actions";
import { redirect } from "next/navigation";

import { OrganizationPicker } from "../../components/organization-picker.tsx";
import { runForMember } from "../../server/actions.ts";
import { currencyName, currencyOptions } from "../../server/currencies.ts";
import {
  activeMembership,
  listMyOrganizations,
  requireSignedIn,
} from "../../server/session.ts";
import { FinishSetUpForm } from "./organizations/finish-set-up-form.tsx";

export const metadata: Metadata = { title: "Home" };

/** The home currency, or what to do while an organization has none yet. */
function HomeCurrency({
  homeCurrency,
  role,
}: {
  homeCurrency: string | undefined;
  role: Role;
}) {
  if (homeCurrency) {
    return (
      <p>
        Home currency: {homeCurrency} ({currencyName(homeCurrency)})
      </p>
    );
  }
  if (role === "owner") return <FinishSetUpForm options={currencyOptions} />;
  return (
    <p>The owner hasn&apos;t finished setting up this organization yet.</p>
  );
}

export default async function HomePage() {
  const session = await requireSignedIn();
  const membership = await activeMembership();

  if (!membership) {
    const organizations = await listMyOrganizations();
    if (organizations.length === 0) redirect("/organizations/new");
    return (
      <>
        <h1>Choose an organization</h1>
        <OrganizationPicker organizations={organizations} />
      </>
    );
  }

  const settings = await runForMember((ctx) => getOrganizationSettings(ctx));

  return (
    <>
      <h1>{membership.organizationName}</h1>
      <p>
        Signed in as {session.user.name} ({session.user.email}). Your role here:{" "}
        <strong>{membership.role}</strong>.
      </p>
      <HomeCurrency
        homeCurrency={settings.ok ? settings.settings.homeCurrency : undefined}
        role={membership.role}
      />
    </>
  );
}
