"use client";

import { useRouter } from "next/navigation";

import { signOutHere } from "../lib/session-changes.ts";
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
        onClick={() => void run(() => signOutHere(router))}
      >
        Sign out
      </button>
      <FormError message={error} />
    </>
  );
}
