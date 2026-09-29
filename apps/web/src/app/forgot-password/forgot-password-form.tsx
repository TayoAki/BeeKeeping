"use client";

import { useState, type FormEvent } from "react";

import { FormError } from "../../components/form-error.tsx";
import { SubmitButton } from "../../components/submit-button.tsx";
import { authClient } from "../../lib/auth-client.ts";
import { fieldText } from "../../lib/form.ts";
import { useRequest } from "../../lib/use-request.ts";

export function ForgotPasswordForm() {
  const [sentTo, setSentTo] = useState<string>();
  const { pending, error, run } = useRequest();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = fieldText(new FormData(event.currentTarget), "email");
    setSentTo(undefined);
    void run(async () => {
      const result = await authClient.requestPasswordReset({
        email,
        redirectTo: "/reset-password",
      });
      if (result.error) {
        return result.error.message ?? "We couldn't send the link.";
      }
      // Every address gets an email, so the answer is the same for all.
      setSentTo(email);
      return undefined;
    });
  }

  return (
    <form onSubmit={submit}>
      <label htmlFor="email">Email</label>
      <input
        id="email"
        name="email"
        type="email"
        autoComplete="email"
        required
      />
      <FormError message={error} />
      <p role="status">
        {sentTo ? `We emailed ${sentTo} with what to do next.` : ""}
      </p>
      <SubmitButton pending={pending}>Email me a link</SubmitButton>
    </form>
  );
}
