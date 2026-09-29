import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { money } from "../index.ts";

// FC_SEED and FC_RUNS repeat or lengthen a run. A failure prints its seed.
// A mistyped value fails loudly instead of running no cases.
function wholeNumber(name: string, fallback?: number): number | undefined {
  const text = process.env[name];
  if (text === undefined || text === "") return fallback;
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(
      `${name} must be a whole number, not ${JSON.stringify(text)}`,
    );
  }
  return value;
}
const seed = wholeNumber("FC_SEED");
const numRuns = wholeNumber("FC_RUNS", 500) ?? 500;
if (numRuns < 1) throw new Error("FC_RUNS must be 1 or more");
fc.configureGlobal({ numRuns, ...(seed === undefined ? {} : { seed }) });

const amount = fc.bigInt({ min: money.MIN_MINOR, max: money.MAX_MINOR });
const currency = fc.constantFrom(...money.currencyCodes);
const numerator = fc.bigInt({ min: -(10n ** 30n), max: 10n ** 30n });
const denominator = fc.bigInt({ min: 1n, max: 10n ** 12n });

/** Half up by a different route: compare doubled values instead of remainders. */
function referenceHalfUp(n: bigint, d: bigint): bigint {
  const magnitude = (2n * (n < 0n ? -n : n) + d) / (2n * d);
  return n < 0n ? -magnitude : magnitude;
}

describe("money properties", () => {
  it("parses every formatted amount back to the same minor units", () => {
    fc.assert(
      fc.property(amount, currency, fc.boolean(), (minor, code, accounting) => {
        const text = money.format(minor, code, { accounting });
        expect(money.parse(text, code)).toEqual({ ok: true, minor });
      }),
    );
  });

  it("reads every exact decimal string back to the same minor units", () => {
    fc.assert(
      fc.property(amount, currency, (minor, code) => {
        const parsed = money.parseDecimal(money.toDecimalString(minor, code));
        expect(parsed.ok && money.toMinor(parsed.value, code)).toEqual({
          ok: true,
          minor,
        });
      }),
    );
  });

  it("rounds half up the same way as a reference", () => {
    fc.assert(
      fc.property(numerator, denominator, (n, d) => {
        expect(money.divideHalfUp(n, d)).toBe(referenceHalfUp(n, d));
      }),
    );
  });

  it("never rounds by more than half a unit", () => {
    fc.assert(
      fc.property(numerator, denominator, (n, d) => {
        const error = n - money.divideHalfUp(n, d) * d;
        expect(2n * (error < 0n ? -error : error) <= d).toBe(true);
      }),
    );
  });

  it("rounds a negative amount to the negative of the positive one", () => {
    fc.assert(
      fc.property(numerator, denominator, (n, d) => {
        expect(money.divideHalfUp(-n, d)).toBe(-money.divideHalfUp(n, d));
      }),
    );
  });

  it("keeps order: a larger amount never rounds smaller", () => {
    fc.assert(
      fc.property(numerator, numerator, denominator, (a, b, d) => {
        const [low, high] = a <= b ? [a, b] : [b, a];
        expect(money.divideHalfUp(low, d) <= money.divideHalfUp(high, d)).toBe(
          true,
        );
      }),
    );
  });

  it("rounds a decimal amount to cents in one step", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 15n), max: 10n ** 15n }),
        fc.integer({ min: 3, max: 8 }),
        (units, scale) => {
          const expected = referenceHalfUp(units, 10n ** BigInt(scale - 2));
          expect(money.toMinor({ units, scale }, "USD")).toEqual({
            ok: true,
            minor: expected,
          });
        },
      ),
    );
  });

  it("leaves an amount alone when multiplied by one", () => {
    fc.assert(
      fc.property(amount, fc.integer({ min: 0, max: 12 }), (minor, scale) => {
        const one = { units: 10n ** BigInt(scale), scale };
        expect(money.multiply(minor, one)).toEqual({ ok: true, minor });
      }),
    );
  });
});
