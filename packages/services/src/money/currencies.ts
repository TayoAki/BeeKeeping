import { fail, ok, type Result } from "../result.ts";

/**
 * Currencies BeeKeeping accepts, with their ISO 4217 minor unit exponents.
 * Stored amounts are integers in minor units, so an exponent here must never
 * change once a currency is in use. Add new currencies freely.
 */
export const currencies = {
  AED: { exponent: 2, name: "UAE dirham" },
  ARS: { exponent: 2, name: "Argentine peso" },
  AUD: { exponent: 2, name: "Australian dollar" },
  BHD: { exponent: 3, name: "Bahraini dinar" },
  BRL: { exponent: 2, name: "Brazilian real" },
  CAD: { exponent: 2, name: "Canadian dollar" },
  CHF: { exponent: 2, name: "Swiss franc" },
  CLP: { exponent: 0, name: "Chilean peso" },
  CNY: { exponent: 2, name: "Chinese yuan" },
  COP: { exponent: 2, name: "Colombian peso" },
  CZK: { exponent: 2, name: "Czech koruna" },
  DKK: { exponent: 2, name: "Danish krone" },
  EUR: { exponent: 2, name: "Euro" },
  GBP: { exponent: 2, name: "Pound sterling" },
  HKD: { exponent: 2, name: "Hong Kong dollar" },
  HUF: { exponent: 2, name: "Hungarian forint" },
  IDR: { exponent: 2, name: "Indonesian rupiah" },
  ILS: { exponent: 2, name: "Israeli new shekel" },
  INR: { exponent: 2, name: "Indian rupee" },
  ISK: { exponent: 0, name: "Icelandic krona" },
  JOD: { exponent: 3, name: "Jordanian dinar" },
  JPY: { exponent: 0, name: "Japanese yen" },
  KRW: { exponent: 0, name: "South Korean won" },
  KWD: { exponent: 3, name: "Kuwaiti dinar" },
  MXN: { exponent: 2, name: "Mexican peso" },
  MYR: { exponent: 2, name: "Malaysian ringgit" },
  NOK: { exponent: 2, name: "Norwegian krone" },
  NZD: { exponent: 2, name: "New Zealand dollar" },
  OMR: { exponent: 3, name: "Omani rial" },
  PEN: { exponent: 2, name: "Peruvian sol" },
  PHP: { exponent: 2, name: "Philippine peso" },
  PLN: { exponent: 2, name: "Polish zloty" },
  SAR: { exponent: 2, name: "Saudi riyal" },
  SEK: { exponent: 2, name: "Swedish krona" },
  SGD: { exponent: 2, name: "Singapore dollar" },
  THB: { exponent: 2, name: "Thai baht" },
  TND: { exponent: 3, name: "Tunisian dinar" },
  TRY: { exponent: 2, name: "Turkish lira" },
  TWD: { exponent: 2, name: "New Taiwan dollar" },
  USD: { exponent: 2, name: "US dollar" },
  ZAR: { exponent: 2, name: "South African rand" },
} as const satisfies Record<string, { exponent: 0 | 2 | 3; name: string }>;

export type CurrencyCode = keyof typeof currencies;

export const currencyCodes = Object.keys(currencies) as CurrencyCode[];

export function isCurrencyCode(code: string): code is CurrencyCode {
  return Object.hasOwn(currencies, code);
}

/** Reads a currency code typed or imported as text, such as " usd ". */
export function parseCurrencyCode(
  text: string,
): Result<{ currency: CurrencyCode }, "unknown_currency"> {
  const code = text.trim().toUpperCase();
  return isCurrencyCode(code)
    ? ok({ currency: code })
    : fail("unknown_currency");
}

/** Digits after the decimal point: 2 for USD, 0 for JPY, 3 for BHD. */
export function exponentOf(currency: CurrencyCode): number {
  return currencies[currency].exponent;
}
