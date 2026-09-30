"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";

import { FormError } from "../../components/form-error.tsx";
import { SubmitButton } from "../../components/submit-button.tsx";
import { authClient } from "../../lib/auth-client.ts";
import { fieldText } from "../../lib/form.ts";
import { useRequest } from "../../lib/use-request.ts";

const messages: Record<string, string> = {
  INVALID_LINK:
    "This link has expired or isn't valid. Sign in with your password, and we'll email you a new one.",
  CONFIRMED_ALREADY:
    "This address is confirmed already. Sign in with your password.",
  WRONG_PASSWORD:
    "That isn't this account's password. If you don't know it, choose a new one with Forgot your password.",
};

export function ConfirmEmailForm({
  token,
  next,
}: {
  token: string;
  next: string;
}) {
  const router = useRouter();
  const { pending, error, run } = useRequest();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = fieldText(new FormData(event.currentTarget), "password");
    void run(async () => {
      // Through /api/auth, so the rate limit for this path applies.
      const result = await authClient.$fetch<{ status: boolean }>(
        "/confirm-email",
        { method: "POST", body: { token, password } },
      );
      if (result.error) {
        if (result.error.status === 429) {
          return "Too many tries. Wait a minute, then try again.";
        }
        // The server answered, so a lost connection isn't the reason.
        const code = (result.error as { code?: string }).code ?? "";
        return (
          messages[code] ??
          "We couldn't confirm your address. Try again in a minute."
        );
      }
      router.replace(next as Parameters<typeof router.replace>[0]);
      router.refresh();
      return undefined;
    });
  }

  return (
    <form method="post" onSubmit={submit}>
      <p>
        Enter your BeeKeeping password to show the account is yours. If you
        reset it after signing up, use the new one.
      </p>
      <label htmlFor="password">Password</label>
      <input
        id="password"
        name="password"
        type="password"
        autoComplete="current-password"
        maxLength={128}
        required
      />
      <FormError message={error} />
      <SubmitButton pending={pending}>Confirm and sign in</SubmitButton>
      <p>
        Don&apos;t know the password, or didn&apos;t sign up?{" "}
        <Link href="/forgot-password">Forgot your password?</Link>
      </p>
    </form>
  );
}
