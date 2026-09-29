"use client";

import { organizationNameLimit } from "@beekeeping/actions/organization/name";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";

import { FormError } from "../../../components/form-error.tsx";
import { SubmitButton } from "../../../components/submit-button.tsx";
import { failureOf } from "../../../lib/auth-call.ts";
import { authClient } from "../../../lib/auth-client.ts";
import { fieldText } from "../../../lib/form.ts";
import { useRequest } from "../../../lib/use-request.ts";

/** A web address for the organization: its name in lowercase, plus a suffix. */
function slugFor(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  const suffix = crypto.randomUUID().slice(0, 6);
  return base ? `${base}-${suffix}` : suffix;
}

export function NewOrganizationForm() {
  const router = useRouter();
  const { pending, error, run } = useRequest();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = fieldText(new FormData(event.currentTarget), "name").trim();
    void run(async () => {
      const failure = await failureOf(
        authClient.organization.create({ name, slug: slugFor(name) }),
        "We couldn't create the organization.",
      );
      if (failure) return failure;
      router.replace("/");
      router.refresh();
      return undefined;
    });
  }

  return (
    <form onSubmit={submit}>
      <label htmlFor="name">Business name</label>
      <input
        id="name"
        name="name"
        autoComplete="organization"
        maxLength={organizationNameLimit}
        required
      />
      <FormError message={error} />
      <SubmitButton pending={pending}>Create organization</SubmitButton>
    </form>
  );
}
