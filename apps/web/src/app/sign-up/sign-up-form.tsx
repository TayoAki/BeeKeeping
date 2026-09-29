"use client";

import { personNameLimit } from "@beekeeping/actions/auth/name";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { FormError } from "../../components/form-error.tsx";
import { SubmitButton } from "../../components/submit-button.tsx";
import { authClient } from "../../lib/auth-client.ts";
import { fieldText } from "../../lib/form.ts";
import { useRequest } from "../../lib/use-request.ts";

export function SignUpForm({ next }: { next: string }) {
  const [sentTo, setSentTo] = useState<string>();
  const { pending, error, run } = useRequest();
  const status = useRef<HTMLParagraphElement>(null);

  // The form goes away once the email is sent, so focus moves to the
  // message instead of being lost.
  useEffect(() => {
    if (sentTo) status.current?.focus();
  }, [sentTo]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = fieldText(form, "email");
    void run(async () => {
      const result = await authClient.signUp.email({
        name: fieldText(form, "name"),
        email,
        password: fieldText(form, "password"),
        callbackURL: next,
      });
      if (result.error) {
        return result.error.message ?? "We couldn't create your account.";
      }
      setSentTo(email);
      return undefined;
    });
  }

  const message = (
    <p role="status" ref={status} tabIndex={-1}>
      {sentTo
        ? `Check your email. We sent a link to ${sentTo} to confirm your address.`
        : ""}
    </p>
  );

  // One structure throughout, so the status element stays the same one and
  // screen readers announce the text that appears in it.
  return (
    <>
      {message}
      {sentTo ? null : (
        <form onSubmit={submit} aria-describedby="sign-up-error">
          <label htmlFor="name">Your name</label>
          <input
            id="name"
            name="name"
            autoComplete="name"
            maxLength={personNameLimit}
            required
          />
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
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            aria-describedby="password-hint"
            required
          />
          <p id="password-hint" className="hint">
            At least 12 characters.
          </p>
          <div id="sign-up-error">
            <FormError message={error} />
          </div>
          <SubmitButton pending={pending}>Create account</SubmitButton>
        </form>
      )}
    </>
  );
}
