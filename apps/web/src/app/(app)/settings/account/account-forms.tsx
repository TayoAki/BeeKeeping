"use client";

import { personNameLimit } from "@beekeeping/actions/auth/name";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { FormError } from "../../../../components/form-error.tsx";
import { SubmitButton } from "../../../../components/submit-button.tsx";
import { failureOf } from "../../../../lib/auth-call.ts";
import { authClient } from "../../../../lib/auth-client.ts";
import { fieldText } from "../../../../lib/form.ts";
import { useRequest } from "../../../../lib/use-request.ts";

type Setup = { totpURI: string; backupCodes: string[] };

/** The secret an authenticator app asks for when you type it in by hand. */
function secretFrom(totpURI: string): string {
  return new URL(totpURI).searchParams.get("secret") ?? "";
}

export function TwoFactorSettings({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const { pending, error, run } = useRequest();
  const [setup, setSetup] = useState<Setup>();
  const heading = useRef<HTMLHeadingElement>(null);
  const shown = useRef(false);

  // Each step replaces the form, button and all, so focus moves to the new
  // step's heading instead of falling to the page.
  useEffect(() => {
    if (shown.current) heading.current?.focus();
    shown.current = true;
  }, [setup, enabled]);

  function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = fieldText(new FormData(event.currentTarget), "password");
    void run(async () => {
      const result = await authClient.twoFactor.enable({ password });
      if (result.error) {
        return result.error.message ?? "We couldn't start two-factor sign-in.";
      }
      if (result.data.method !== "totp") {
        return "We couldn't start two-factor sign-in.";
      }
      setSetup({
        totpURI: result.data.totpURI,
        backupCodes: result.data.backupCodes,
      });
      return undefined;
    });
  }

  function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = fieldText(new FormData(event.currentTarget), "code");
    void run(async () => {
      const result = await authClient.twoFactor.verifyTotp({ code });
      if (result.error) return result.error.message ?? "That code didn't work.";
      setSetup(undefined);
      router.refresh();
      return undefined;
    });
  }

  function turnOff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = fieldText(new FormData(event.currentTarget), "password");
    void run(async () => {
      const result = await authClient.twoFactor.disable({ password });
      if (result.error) {
        return result.error.message ?? "We couldn't turn it off.";
      }
      router.refresh();
      return undefined;
    });
  }

  if (setup) {
    return (
      <form
        method="post"
        onSubmit={confirm}
        aria-labelledby="two-factor-heading"
      >
        <h2 id="two-factor-heading" ref={heading} tabIndex={-1}>
          Finish two-factor sign-in
        </h2>
        <p>
          Add BeeKeeping to your authenticator app with{" "}
          <a href={setup.totpURI}>this link</a>, or type in the key{" "}
          <code>{secretFrom(setup.totpURI)}</code>.
        </p>
        <p>
          Keep these backup codes somewhere safe. Each one works once if you
          lose your phone:
        </p>
        <ul>
          {setup.backupCodes.map((code) => (
            <li key={code}>
              <code>{code}</code>
            </li>
          ))}
        </ul>
        <label htmlFor="code">Code from the app</label>
        <input
          id="code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          required
        />
        <FormError message={error} />
        <SubmitButton pending={pending}>
          Turn on two-factor sign-in
        </SubmitButton>
      </form>
    );
  }

  return (
    <form
      method="post"
      onSubmit={enabled ? turnOff : start}
      aria-labelledby="two-factor-heading"
    >
      <h2 id="two-factor-heading" ref={heading} tabIndex={-1}>
        Two-factor sign-in
      </h2>
      <p>
        {enabled
          ? "On. Signing in asks for a code from your authenticator app."
          : "Off. Turn it on to ask for a code from an authenticator app after your password."}
      </p>
      <label htmlFor="two-factor-password">Your password</label>
      <input
        id="two-factor-password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
      />
      <FormError message={error} />
      <SubmitButton pending={pending}>
        {enabled ? "Turn off two-factor sign-in" : "Set up two-factor sign-in"}
      </SubmitButton>
    </form>
  );
}

/** The name that invitations and the members list show. */
export function NameForm({ name }: { name: string }) {
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  const { pending, error, run } = useRequest();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = fieldText(new FormData(event.currentTarget), "name").trim();
    setSaved(false);
    void run(async () => {
      const failure = await failureOf(
        authClient.updateUser({ name: next }),
        "We couldn't save your name.",
      );
      if (failure) return failure;
      setSaved(true);
      router.refresh();
      return undefined;
    });
  }

  return (
    <form method="post" onSubmit={submit} aria-labelledby="name-heading">
      <h2 id="name-heading">Your name</h2>
      <label htmlFor="name">Name</label>
      <input
        id="name"
        name="name"
        autoComplete="name"
        defaultValue={name}
        maxLength={personNameLimit}
        required
      />
      <FormError message={error} />
      <p role="status">{saved ? "Your name is saved." : ""}</p>
      <SubmitButton pending={pending}>Save name</SubmitButton>
    </form>
  );
}

export function SignOutEverywhere() {
  const router = useRouter();
  const { pending, error, run } = useRequest();
  return (
    <section aria-labelledby="sessions-heading">
      <h2 id="sessions-heading">Sessions</h2>
      <p>Signs you out on every device and browser, including this one.</p>
      <button
        type="button"
        className="secondary"
        aria-disabled={pending}
        onClick={() => {
          void run(async () => {
            // Someone who fears a stolen session must know if this failed.
            const failure = await failureOf(
              authClient.revokeSessions(),
              "We couldn't sign you out everywhere. Try again.",
            );
            if (failure) return failure;
            router.replace("/sign-in");
            router.refresh();
            return undefined;
          });
        }}
      >
        Sign out everywhere
      </button>
      <FormError message={error} />
    </section>
  );
}
