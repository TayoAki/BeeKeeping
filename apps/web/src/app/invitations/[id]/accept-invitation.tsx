"use client";

import { useRouter } from "next/navigation";

import { FormError } from "../../../components/form-error.tsx";
import { failureOf } from "../../../lib/auth-call.ts";
import { authClient } from "../../../lib/auth-client.ts";
import { useRequest } from "../../../lib/use-request.ts";

export function AcceptInvitation({ invitationId }: { invitationId: string }) {
  const router = useRouter();
  const { pending, error, run } = useRequest();
  return (
    <>
      <button
        type="button"
        aria-disabled={pending}
        onClick={() => {
          void run(async () => {
            const failure = await failureOf(
              authClient.organization.acceptInvitation({ invitationId }),
              "We couldn't accept the invitation.",
            );
            if (failure) return failure;
            router.replace("/");
            router.refresh();
            return undefined;
          });
        }}
      >
        Accept and join
      </button>
      <FormError message={error} />
    </>
  );
}
