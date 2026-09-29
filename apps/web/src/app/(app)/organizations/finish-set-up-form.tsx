"use client";

import { useRouter } from "next/navigation";
import type { FormEvent } from "react";

import {
  CurrencyField,
  type CurrencyOption,
} from "../../../components/currency-field.tsx";
import { FormError } from "../../../components/form-error.tsx";
import { SubmitButton } from "../../../components/submit-button.tsx";
import { fieldText } from "../../../lib/form.ts";
import { useRequest } from "../../../lib/use-request.ts";
import { setUpOrganizationAction } from "./actions.ts";

/** For an owner whose organization has no home currency yet. */
export function FinishSetUpForm({ options }: { options: CurrencyOption[] }) {
  const router = useRouter();
  const { pending, error, run } = useRequest();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const homeCurrency = fieldText(
      new FormData(event.currentTarget),
      "homeCurrency",
    );
    void run(async () => {
      const outcome = await setUpOrganizationAction({ homeCurrency });
      if (!outcome.ok) return outcome.message;
      router.refresh();
      return undefined;
    });
  }

  return (
    <form onSubmit={submit} aria-labelledby="finish-heading">
      <h2 id="finish-heading">Finish setting up</h2>
      <CurrencyField options={options} />
      <FormError message={error} />
      <SubmitButton pending={pending}>Save</SubmitButton>
    </form>
  );
}
