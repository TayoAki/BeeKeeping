import type { Metadata } from "next";
import Link from "next/link";

import { ResetPasswordForm } from "./reset-password-form.tsx";

export const metadata: Metadata = {
  title: "Choose a new password",
  // The address holds the reset token. No request from this page names it.
  referrer: "no-referrer",
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token, error } = await searchParams;
  // Better Auth sends a link that has expired or was used back here with an
  // error instead of a token.
  const usable = typeof token === "string" && token !== "" && !error;
  return (
    <main>
      <h1>Choose a new password</h1>
      {usable ? (
        <ResetPasswordForm token={token} />
      ) : (
        <p>
          This link has expired or was used already.{" "}
          <Link href="/forgot-password">Ask for a new one</Link>.
        </p>
      )}
    </main>
  );
}
