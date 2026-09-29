"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { authClient } from "../lib/auth-client.ts";
import { failureOf } from "../lib/auth-call.ts";
import { FormError } from "./form-error.tsx";

export function OrganizationPicker({
  organizations,
}: {
  organizations: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  return (
    <>
      <ul>
        {organizations.map(({ id, name }) => (
          <li key={id}>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                void (async () => {
                  setError(undefined);
                  const failure = await failureOf(
                    authClient.organization.setActive({ organizationId: id }),
                    "We couldn't open that organization.",
                  );
                  if (failure) {
                    setError(failure);
                    return;
                  }
                  router.refresh();
                })();
              }}
            >
              {name}
            </button>
          </li>
        ))}
      </ul>
      <FormError message={error} />
    </>
  );
}
