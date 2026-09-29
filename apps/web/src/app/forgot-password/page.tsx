import type { Metadata } from "next";
import Link from "next/link";

import { ForgotPasswordForm } from "./forgot-password-form.tsx";

export const metadata: Metadata = { title: "Reset your password" };

export default function ForgotPasswordPage() {
  return (
    <main>
      <h1>Reset your password</h1>
      <p>
        We&apos;ll email you a link to choose a new one. If you have two-factor
        sign-in on, it still asks for your code afterwards.
      </p>
      <ForgotPasswordForm />
      <p>
        <Link href="/sign-in">Back to sign-in</Link>
      </p>
    </main>
  );
}
