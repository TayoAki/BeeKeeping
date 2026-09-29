"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { FormError } from "../../components/form-error.tsx";
import { SubmitButton } from "../../components/submit-button.tsx";
import { authClient } from "../../lib/auth-client.ts";
import { fieldText } from "../../lib/form.ts";
import { useRequest } from "../../lib/use-request.ts";

export function ResetPasswordForm({ token }: { token: string }) {
  const [done, setDone] = useState(false);
  const { pending, error, run } = useRequest();
  const status = useRef<HTMLParagraphElement>(null);

  // The form goes away once the password changes, so focus moves to the
  // message instead of being lost.
  useEffect(() => {
    if (done) status.current?.focus();
  }, [done]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const newPassword = fieldText(
      new FormData(event.currentTarget),
      "password",
    );
    void run(async () => {
      const result = await authClient.resetPassword({ newPassword, token });
      if (result.error) {
        return result.error.code === "INVALID_TOKEN"
          ? "This link has expired or was used already. Ask for a new one."
          : (result.error.message ?? "We couldn't change your password.");
      }
      setDone(true);
      return undefined;
    });
  }

  return (
    <>
      <p role="status" ref={status} tabIndex={-1}>
        {done
          ? "Your password has changed, and you're signed out everywhere. Sign in with the new one."
          : ""}
      </p>
      {done ? (
        <p>
          <Link href="/sign-in">Sign in</Link>
        </p>
      ) : (
        <form onSubmit={submit}>
          <label htmlFor="password">New password</label>
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
          <FormError message={error} />
          <SubmitButton pending={pending}>Change password</SubmitButton>
          <p>
            <Link href="/forgot-password">Ask for a new link</Link>
          </p>
        </form>
      )}
    </>
  );
}
