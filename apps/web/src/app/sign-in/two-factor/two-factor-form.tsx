"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { FormError } from "../../../components/form-error.tsx";
import { SubmitButton } from "../../../components/submit-button.tsx";
import { authClient } from "../../../lib/auth-client.ts";
import { fieldText } from "../../../lib/form.ts";
import { useRequest } from "../../../lib/use-request.ts";

/**
 * The second step of signing in: a code from the authenticator app, or one
 * of the backup codes for someone who lost it.
 */
export function TwoFactorForm({ next }: { next: string }) {
  const router = useRouter();
  const { pending, error, run } = useRequest();
  const [backup, setBackup] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = fieldText(new FormData(event.currentTarget), "code").trim();
    void run(async () => {
      const result = backup
        ? await authClient.twoFactor.verifyBackupCode({ code })
        : await authClient.twoFactor.verifyTotp({ code });
      if (result.error) return result.error.message ?? "That code didn't work.";
      router.replace(next as Parameters<typeof router.replace>[0]);
      router.refresh();
      return undefined;
    });
  }

  return (
    <form onSubmit={submit}>
      {backup ? (
        <>
          <label htmlFor="code">Backup code</label>
          <input
            key="backup"
            id="code"
            name="code"
            autoComplete="off"
            aria-describedby="code-hint"
            required
          />
          <p id="code-hint" className="hint">
            One of the codes you saved when you turned on two-factor sign-in.
            Each one works once.
          </p>
        </>
      ) : (
        <>
          <label htmlFor="code">Code from your authenticator app</label>
          <input
            key="app"
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
          />
        </>
      )}
      <FormError message={error} />
      <SubmitButton pending={pending}>Verify</SubmitButton>{" "}
      <button
        type="button"
        className="secondary"
        onClick={() => setBackup(!backup)}
      >
        {backup ? "Use the authenticator app" : "Use a backup code"}
      </button>
    </form>
  );
}
