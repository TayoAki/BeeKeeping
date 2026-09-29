"use client";

import { invitableRoles } from "@beekeeping/actions/access";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { FormError } from "../../../components/form-error.tsx";
import { SubmitButton } from "../../../components/submit-button.tsx";
import { failureOf } from "../../../lib/auth-call.ts";
import { authClient } from "../../../lib/auth-client.ts";
import { fieldText } from "../../../lib/form.ts";
import { useRequest } from "../../../lib/use-request.ts";

type InvitableRole = (typeof invitableRoles)[number];

export function InviteForm() {
  const router = useRouter();
  const [sentTo, setSentTo] = useState<string>();
  const { pending, error, run } = useRequest();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const email = fieldText(form, "email");
    setSentTo(undefined);
    void run(async () => {
      const result = await authClient.organization.inviteMember({
        email,
        role: fieldText(form, "role") as InvitableRole,
      });
      if (result.error) {
        return result.error.message ?? "We couldn't send the invitation.";
      }
      formElement.reset();
      setSentTo(email);
      router.refresh();
      return undefined;
    });
  }

  return (
    <form onSubmit={submit} aria-labelledby="invite-heading">
      <h2 id="invite-heading">Invite someone</h2>
      <label htmlFor="email">Email</label>
      <input id="email" name="email" type="email" autoComplete="off" required />
      <label htmlFor="role">Role</label>
      <select id="role" name="role" defaultValue="bookkeeper">
        {invitableRoles.map((role) => (
          <option key={role} value={role}>
            {role}
          </option>
        ))}
      </select>
      <FormError message={error} />
      <p role="status">
        {sentTo ? `We emailed an invitation to ${sentTo}.` : ""}
      </p>
      <SubmitButton pending={pending}>Send invitation</SubmitButton>
    </form>
  );
}

/** A button that runs one call to the auth client, then refreshes the page. */
function ActionButton({
  label,
  run: call,
  fallback,
  children,
}: {
  label: string;
  run: () => Promise<{ error: { message?: string } | null }>;
  fallback: string;
  children: string;
}) {
  const router = useRouter();
  const { pending, error, run } = useRequest();
  return (
    <>
      <button
        type="button"
        className="secondary"
        aria-label={label}
        aria-disabled={pending}
        onClick={() => {
          void run(async () => {
            const failure = await failureOf(call(), fallback);
            if (failure) return failure;
            router.refresh();
            return undefined;
          });
        }}
      >
        {children}
      </button>
      <FormError message={error} />
    </>
  );
}

export function RemoveMemberButton({
  memberId,
  name,
}: {
  memberId: string;
  name: string;
}) {
  return (
    <ActionButton
      label={`Remove ${name}`}
      run={() =>
        authClient.organization.removeMember({ memberIdOrEmail: memberId })
      }
      fallback="We couldn't remove them."
    >
      Remove
    </ActionButton>
  );
}

export function CancelInvitationButton({
  invitationId,
  email,
}: {
  invitationId: string;
  email: string;
}) {
  return (
    <ActionButton
      label={`Cancel the invitation to ${email}`}
      run={() => authClient.organization.cancelInvitation({ invitationId })}
      fallback="We couldn't cancel the invitation."
    >
      Cancel
    </ActionButton>
  );
}
