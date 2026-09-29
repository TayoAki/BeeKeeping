import { fail, ok, type Result } from "../result.ts";
import { exponentOf, type CurrencyCode } from "./currencies.ts";

/** The range of a Postgres bigint, where amounts are stored. */
export const MIN_MINOR = -(2n ** 63n);
export const MAX_MINOR = 2n ** 63n - 1n;

/** The exact decimal text of an amount: 123456n in USD is "1234.56". */
export function toDecimalString(minor: bigint, currency: CurrencyCode): string {
  const exponent = exponentOf(currency);
  const digits = (minor < 0n ? -minor : minor)
    .toString()
    .padStart(exponent + 1, "0");
  const whole = digits.slice(0, digits.length - exponent);
  const fraction = digits.slice(digits.length - exponent);
  const sign = minor < 0n ? "-" : "";
  return exponent === 0 ? `${sign}${whole}` : `${sign}${whole}.${fraction}`;
}

const formatters = new Map<string, Intl.NumberFormat>();

function formatter(
  currency: CurrencyCode,
  accounting: boolean,
): Intl.NumberFormat {
  const key = `${currency}:${accounting ? "accounting" : "standard"}`;
  let cached = formatters.get(key);
  if (!cached) {
    const digits = exponentOf(currency);
    cached = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      currencySign: accounting ? "accounting" : "standard",
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    formatters.set(key, cached);
  }
  return cached;
}

/**
 * Formats an amount for people to read, as in "$1,234.56". With accounting
 * set, negatives show in parentheses: "($12.50)".
 */
export function format(
  minor: bigint,
  currency: CurrencyCode,
  { accounting = false }: { accounting?: boolean } = {},
): string {
  const decimal = toDecimalString(minor, currency) as `${number}`;
  return formatter(currency, accounting).format(decimal);
}

/** The marks that may stand next to an amount, such as "USD", "$" or "CA$". */
function currencyMarks(currency: CurrencyCode): string[] {
  const marks = new Set<string>([currency]);
  for (const currencyDisplay of ["symbol", "narrowSymbol"] as const) {
    const part = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      currencyDisplay,
    })
      .formatToParts(0)
      .find(({ type }) => type === "currency");
    if (part) marks.add(part.value);
  }
  // Longest first, so "CA$" goes before "$" gets a chance.
  return [...marks].sort((a, b) => b.length - a.length);
}

function stripMark(text: string, marks: string[], at: "start" | "end") {
  const upper = text.toUpperCase();
  for (const mark of marks) {
    const markUpper = mark.toUpperCase();
    if (at === "start" && upper.startsWith(markUpper)) {
      return text.slice(mark.length).trim();
    }
    if (at === "end" && upper.endsWith(markUpper)) {
      return text.slice(0, text.length - mark.length).trim();
    }
  }
  return text;
}

const MINUS = "−";

/** Removes a leading sign: "-", the Unicode minus sign, or "+". */
function takeSign(text: string): { sign?: "-" | "+"; rest: string } {
  const first = text.charAt(0);
  if (first === "-" || first === MINUS) {
    return { sign: "-", rest: text.slice(1).trim() };
  }
  if (first === "+") return { sign: "+", rest: text.slice(1).trim() };
  return { rest: text };
}

export type ParseFailure =
  "empty" | "invalid" | "too_many_decimals" | "out_of_range";

/**
 * Reads an amount a person typed or a file held, such as "1,234.56",
 * "$1,234.56", "-12.50", "(12.50)", ".5" or "12.50 USD". Digits past the
 * currency's minor unit must be zeros: a typed amount is never rounded.
 */
export function parse(
  input: string,
  currency: CurrencyCode,
): Result<{ minor: bigint }, ParseFailure> {
  let text = input.trim();
  if (text === "") return fail("empty");

  // Parentheses mean negative, as in "(12.50)", and then no sign may follow.
  const parenthesized = text.startsWith("(") && text.endsWith(")");
  if (parenthesized) text = text.slice(1, -1).trim();

  // At most one sign, before or after a leading currency mark: "-$12.50" or
  // "$-12.50". A mark may also follow the number: "12.50 USD".
  const marks = currencyMarks(currency);
  const first = takeSign(text);
  const second = takeSign(stripMark(first.rest, marks, "start"));
  text = stripMark(second.rest, marks, "end");
  const signs = [first.sign, second.sign].filter((sign) => sign !== undefined);
  if (signs.length > 1 || (parenthesized && signs.length > 0)) {
    return fail("invalid");
  }
  const negative = parenthesized || signs[0] === "-";

  const match = /^(\d{1,3}(?:,\d{3})+|\d+)?(?:\.(\d+))?$/.exec(text);
  const [, whole = "", fraction = ""] = match ?? [];
  if (!match || (whole === "" && fraction === "")) return fail("invalid");

  const exponent = exponentOf(currency);
  if (/[^0]/.test(fraction.slice(exponent))) return fail("too_many_decimals");

  const magnitude = BigInt(
    `${whole.replaceAll(",", "") || "0"}${fraction.slice(0, exponent).padEnd(exponent, "0")}`,
  );
  const minor = negative ? -magnitude : magnitude;
  if (minor < MIN_MINOR || minor > MAX_MINOR) return fail("out_of_range");
  return ok({ minor });
}
