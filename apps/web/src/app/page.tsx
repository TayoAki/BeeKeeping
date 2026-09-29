import type { Metadata } from "next";
import {
  getOrganizationSettings,
  roleAtLeast,
  type Role,
} from "@beekeeping/actions";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { OrganizationPicker } from "../components/organization-picker.tsx";
import { SignOutButton } from "../components/sign-out-button.tsx";
import { runForMember } from "../server/actions.ts";
import { getAuth } from "../server/auth.ts";
import { currencyName, currencyOptions } from "../server/currencies.ts";
import { activeMembership, requireSignedIn } from "../server/session.ts";
import { FinishSetUpForm } from "./organizations/finish-set-up-form.tsx";

// The root layout's title template reaches child segments only, and this
// page sits in the root segment.
export const metadata: Metadata = { title: { absolute: "Home · BeeKeeping" } };

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
    const organizations = await getAuth().api.listOrganizations({
      headers: await headers(),
    });
    if (organizations.length === 0) redirect("/organizations/new");
    return (
      <main>
        <h1>Choose an organization</h1>
        <OrganizationPicker
          organizations={organizations.map(({ id, name }) => ({ id, name }))}
        />
        <SignOutButton />
      </main>
    );
  }

  const settings = await runForMember((ctx) => getOrganizationSettings(ctx));

  return (
    <main>
      <h1>{membership.organizationName}</h1>
      <p>
        Signed in as {session.user.name} ({session.user.email}). Your role here:{" "}
        <strong>{membership.role}</strong>.
      </p>
      <HomeCurrency
        homeCurrency={settings.ok ? settings.settings.homeCurrency : undefined}
        role={membership.role}
      />
      <nav aria-label="Settings">
        <ul>
          {roleAtLeast(membership.role, "admin") ? (
            <li>
              <Link href="/settings/members">Members</Link>
            </li>
          ) : null}
          <li>
            <Link href="/settings/account">Your account</Link>
          </li>
        </ul>
      </nav>
      <SignOutButton />
    </main>
  );
}
