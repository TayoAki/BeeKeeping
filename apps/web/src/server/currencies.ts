import { money } from "@beekeeping/services";

import type { CurrencyOption } from "../components/currency-field.tsx";

/** Every currency the books can be kept in, by code. */
export const currencyOptions: CurrencyOption[] = Object.entries(
  money.currencies,
)
  .map(([code, { name }]) => ({ code, name }))
  .sort((a, b) => a.code.localeCompare(b.code));

/** A currency's name, such as "Euro" for EUR. */
export function currencyName(code: string): string {
  return currencyOptions.find((option) => option.code === code)?.name ?? code;
}
