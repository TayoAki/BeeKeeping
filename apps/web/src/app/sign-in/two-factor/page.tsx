import type { Metadata } from "next";

import { safeNextPath } from "../../../lib/next-path.ts";
import { TwoFactorForm } from "./two-factor-form.tsx";

export const metadata: Metadata = { title: "Two-factor code" };

export default async function TwoFactorPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const next = safeNextPath((await searchParams).next);
  return (
    <main>
      <h1>Enter your code</h1>
      <p>Your account uses two-factor sign-in.</p>
      <TwoFactorForm next={next} />
    </main>
  );
}
