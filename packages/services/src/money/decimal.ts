import { fail, ok, type Result } from "../result.ts";
import { exponentOf, type CurrencyCode } from "./currencies.ts";

/**
 * An exact decimal number: units × 10^-scale. 8.875 is
 * { units: 8875n, scale: 3 }. Rates and quantities use it, so no amount ever
 * passes through a floating-point number.
 */
export type Decimal = { readonly units: bigint; readonly scale: number };

/** Reads a plain decimal such as "8.875", "-0.5" or "12". */
export function parseDecimal(
  text: string,
): Result<{ value: Decimal }, "invalid_decimal"> {
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(text.trim());
  if (!match) return fail("invalid_decimal");
  const [, sign = "", whole = "", fraction = ""] = match;
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

/** Rounds an exact decimal amount half up to the currency's minor units. */
export function toMinor(value: Decimal, currency: CurrencyCode): bigint {
  const shift = exponentOf(currency) - value.scale;
  return shift >= 0
    ? value.units * 10n ** BigInt(shift)
    : divideHalfUp(value.units, 10n ** BigInt(-shift));
}

/**
 * An amount in minor units times an exact factor, rounded half up to minor
 * units. Quantity times unit price, and amount times a rate, both use it.
 */
export function multiply(minor: bigint, factor: Decimal): bigint {
  return divideHalfUp(minor * factor.units, 10n ** BigInt(factor.scale));
}
