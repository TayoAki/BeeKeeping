import type { Metadata } from "next";

import { currencyOptions } from "../../../../server/currencies.ts";
import { requireSignedIn } from "../../../../server/session.ts";
import { NewOrganizationForm } from "./new-organization-form.tsx";

export const metadata: Metadata = { title: "Set up your business" };

export default async function NewOrganizationPage() {
  await requireSignedIn();
  return (
    <>
      <h1>Set up your business</h1>
      <p>You&apos;ll be its owner. You can invite your team next.</p>
      <NewOrganizationForm currencies={currencyOptions} />
    </>
  );
}
