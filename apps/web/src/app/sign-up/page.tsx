import type { Metadata } from "next";
import Link from "next/link";

import { safeNextPath } from "../../lib/next-path.ts";
import { SignUpForm } from "./sign-up-form.tsx";

export const metadata: Metadata = { title: "Create an account" };

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const next = safeNextPath((await searchParams).next);
  return (
    <main>
      <h1>Create your BeeKeeping account</h1>
      <SignUpForm next={next} />
      <p>
        Already have an account?{" "}
        <Link href={{ pathname: "/sign-in", query: { next } }}>Sign in</Link>
      </p>
    </main>
  );
}
