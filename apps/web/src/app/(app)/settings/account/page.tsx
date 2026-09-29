import type { Metadata } from "next";

import { requireSignedIn } from "../../../../server/session.ts";
import {
  NameForm,
  SignOutEverywhere,
  TwoFactorSettings,
} from "./account-forms.tsx";

export const metadata: Metadata = { title: "Your account" };

export default async function AccountPage() {
  const session = await requireSignedIn();
  return (
    <>
      <h1>Your account</h1>
      <p>
        {session.user.name}, {session.user.email}
      </p>
      <NameForm name={session.user.name} />
      <TwoFactorSettings enabled={session.user.twoFactorEnabled === true} />
      <SignOutEverywhere />
    </>
  );
}
