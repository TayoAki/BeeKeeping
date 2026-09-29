import type { Metadata } from "next";
import Link from "next/link";

import { safeNextPath } from "../../lib/next-path.ts";
import { ConfirmEmailForm } from "./confirm-email-form.tsx";

export const metadata: Metadata = {
  title: "Confirm your email",
  // The address holds the confirmation token. No request from this page
  // names it.
  referrer: "no-referrer",
};

export default async function ConfirmEmailPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const token = typeof query.token === "string" ? query.token : "";
  const next = safeNextPath(query.next);
  return (
    <main>
      <h1>Confirm your email</h1>
      {token ? (
        <ConfirmEmailForm token={token} next={next} />
      ) : (
        <p>
          This link isn&apos;t complete.{" "}
          <Link href="/sign-in">Sign in with your password</Link>, and
          we&apos;ll email you a new one.
        </p>
      )}
    </main>
  );
}
