"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { FormError } from "../../components/form-error.tsx";
import { SubmitButton } from "../../components/submit-button.tsx";
import { authClient } from "../../lib/auth-client.ts";
import { fieldText } from "../../lib/form.ts";
import { useRequest } from "../../lib/use-request.ts";

export function PasswordSignIn({ next }: { next: string }) {
  const router = useRouter();
  const { pending, error, run } = useRequest();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = fieldText(form, "email");
    void run(async () => {
      const result = await authClient.signIn.email({
        email,
        password: fieldText(form, "password"),
        // A new confirmation link, sent when the address isn't confirmed
        // yet, comes back to the same place.
        callbackURL: next,
      });
      if (result.error) {
        // Only the right password reaches the confirmation email, so these
        // answers reveal nothing to anyone else.
        if (result.error.code === "EMAIL_NOT_VERIFIED") {
          return `Confirm your email first. We sent a new link to ${email}.`;
        }
        if (result.error.code === "EMAIL_NOT_SENT") {
          return "Your address isn't confirmed yet, and we couldn't send a new link. Try again in a minute.";
        }
        return result.error.message ?? "We couldn't sign you in.";
      }
      // With two-factor on, the client has already gone to the code page.
      if (!("twoFactorRedirect" in result.data)) {
        router.replace(next as Parameters<typeof router.replace>[0]);
        router.refresh();
      }
      return undefined;
    });
  }

  return (
    <form method="post" onSubmit={submit} aria-labelledby="password-heading">
      <h2 id="password-heading">With your password</h2>
      <label htmlFor="email">Email</label>
      <input
        id="email"
        name="email"
        type="email"
        autoComplete="email"
        required
      />
      <label htmlFor="password">Password</label>
      <input
        id="password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
      />
      <FormError message={error} />
      <SubmitButton pending={pending}>Sign in</SubmitButton>
      <p>
        <Link href="/forgot-password">Forgot your password?</Link>
      </p>
    </form>
  );
}

export function MagicLinkSignIn({ next }: { next: string }) {
  const [sentTo, setSentTo] = useState<string>();
  const { pending, error, run } = useRequest();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = fieldText(new FormData(event.currentTarget), "link-email");
    setSentTo(undefined);
    void run(async () => {
      const result = await authClient.signIn.magicLink({
        email,
        callbackURL: next,
        // A link that has expired, was used or can't sign anyone in comes
        // back here, and the page says so.
        errorCallbackURL: `/sign-in?${new URLSearchParams({ next }).toString()}`,
      });
      if (result.error) {
        return result.error.message ?? "We couldn't send the link.";
      }
      setSentTo(email);
      return undefined;
    });
  }

  return (
    <form method="post" onSubmit={submit} aria-labelledby="link-heading">
      <h2 id="link-heading">With a link by email</h2>
      <label htmlFor="link-email">Email</label>
      <input
        id="link-email"
        name="link-email"
        type="email"
        autoComplete="email"
        required
      />
      <FormError message={error} />
      <p role="status">
        {sentTo ? `We emailed ${sentTo} with how to sign in.` : ""}
      </p>
      <SubmitButton pending={pending} className="secondary">
        Email me a link
      </SubmitButton>
    </form>
  );
}
