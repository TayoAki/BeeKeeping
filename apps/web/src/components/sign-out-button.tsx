"use client";

import { useRouter } from "next/navigation";

import { failureOf } from "../lib/auth-call.ts";
import { authClient } from "../lib/auth-client.ts";
import { useRequest } from "../lib/use-request.ts";
import { FormError } from "./form-error.tsx";

/** Signs out here, and goes to the sign-in page only once that worked. */
export function SignOutButton() {
  const router = useRouter();
  const { pending, error, run } = useRequest();
  return (
    <>
      <button
        type="button"
        className="secondary"
        aria-disabled={pending}
        onClick={() => {
          void run(async () => {
            const failure = await failureOf(
              authClient.signOut(),
              "We couldn't sign you out. Try again.",
            );
            if (failure) return failure;
            router.replace("/sign-in");
            router.refresh();
            return undefined;
          });
        }}
      >
        Sign out
      </button>
      <FormError message={error} />
    </>
  );
}
