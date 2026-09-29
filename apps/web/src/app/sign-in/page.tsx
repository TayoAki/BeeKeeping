import type { Metadata } from "next";
import Link from "next/link";

import { safeNextPath } from "../../lib/next-path.ts";
import { MagicLinkSignIn, PasswordSignIn } from "./sign-in-forms.tsx";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const next = safeNextPath(query.next);
  // Better Auth sends a sign-in link that didn't work back here with an
  // error code. The page says what to do, never the code itself.
  const linkFailed = query.error !== undefined;
  return (
    <main>
      <h1>Sign in to BeeKeeping</h1>
      {linkFailed ? (
        <p role="alert" className="error">
          That sign-in link didn&apos;t work. It may have expired or been used
          already. Ask for a new one, or sign in with your password.
        </p>
      ) : null}
      <PasswordSignIn next={next} />
      <MagicLinkSignIn next={next} />
      <p>
        New here?{" "}
        <Link href={{ pathname: "/sign-up", query: { next } }}>
          Create an account
        </Link>
      </p>
    </main>
  );
}
