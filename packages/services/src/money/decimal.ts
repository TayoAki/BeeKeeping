import { fail, ok, type Result } from "../result.ts";
import { MAX_MINOR, MIN_MINOR } from "./bounds.ts";
import { exponentOf, type CurrencyCode } from "./currencies.ts";

/**
 * An exact decimal number: units × 10^-scale. 8.875 is
 * { units: 8875n, scale: 3 }. Rates and quantities use it, so no amount ever
 * passes through a floating-point number.
 */
export type Decimal = { readonly units: bigint; readonly scale: number };

/** Reads a plain decimal such as "8.875", "-0.5", ".5" or "12". */
export function parseDecimal(
  text: string,
): Result<{ value: Decimal }, "invalid_decimal"> {
  const match = /^([+-]?)(\d*)(?:\.(\d+))?$/.exec(text.trim());
  const [, sign = "", whole = "", fraction = ""] = match ?? [];
  if (!match || (whole === "" && fraction === "")) {
    return fail("invalid_decimal");
  }
  return ok({
    value: {
      units: BigInt(`${sign}${whole}${fraction}`),
      scale: fraction.length,
    },
  });
}

/**
 * numerator ÷ denominator, rounded half up: a tie rounds away from zero, as
 * Postgres rounds numeric values. 5 ÷ 2 is 3 and -5 ÷ 2 is -3.
 */
export function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) {
    throw new RangeError("divideHalfUp needs a positive denominator");
  }
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const doubled = remainder < 0n ? -2n * remainder : 2n * remainder;
  if (doubled < denominator) return quotient;
  return numerator < 0n ? quotient - 1n : quotient + 1n;
}

// A Decimal built by hand with a negative or fractional scale is a bug in
// the caller, not a failure to report.
function checkScale(value: Decimal): void {
  if (!Number.isInteger(value.scale) || value.scale < 0) {
    throw new RangeError("a Decimal's scale must be a whole number, 0 or more");
  }
}

function withinBounds(
  minor: bigint,
): Result<{ minor: bigint }, "out_of_range"> {
  return minor < MIN_MINOR || minor > MAX_MINOR
    ? fail("out_of_range")
    : ok({ minor });
}

/**
 * Rounds an exact decimal amount half up to the currency's minor units, in
 * one step, so 0.0049 USD is 0 cents. An amount too large for a Postgres
 * bigint is out of range.
 */
export function toMinor(
  value: Decimal,
  currency: CurrencyCode,
): Result<{ minor: bigint }, "out_of_range"> {
  checkScale(value);
  const shift = exponentOf(currency) - value.scale;
  return withinBounds(
    shift >= 0
      ? value.units * 10n ** BigInt(shift)
      : divideHalfUp(value.units, 10n ** BigInt(-shift)),
  );
}

/**
 * The exact product of two decimals, with no rounding: 3 × 0.045 is 0.135.
 * A line's quantity times its unit price uses it, since a unit price may
 * carry more decimals than the currency. Round the product once with
 * toMinor.
 */
export function times(a: Decimal, b: Decimal): Decimal {
  checkScale(a);
  checkScale(b);
  return { units: a.units * b.units, scale: a.scale + b.scale };
}

/**
 * An amount already in minor units times an exact factor, such as a tax
 * rate, rounded half up to minor units of the same currency. For quantity
 * times a unit price, use times and then toMinor, so the line rounds once.
 * Converting to another currency changes the minor unit, so it is not a
 * multiply. A result too large for a Postgres bigint is out of range.
 */
export function multiply(
  minor: bigint,
  factor: Decimal,
): Result<{ minor: bigint }, "out_of_range"> {
  checkScale(factor);
  return withinBounds(
    divideHalfUp(minor * factor.units, 10n ** BigInt(factor.scale)),
  );
}
