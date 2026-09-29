import { describe, expect, it } from "vitest";

import { money } from "../index.ts";

const { format, parse, toDecimalString, toMinor, multiply } = money;

function decimal(text: string) {
  const parsed = money.parseDecimal(text);
  if (!parsed.ok) throw new Error(`bad test decimal ${text}`);
  return parsed.value;
}

describe("currencies", () => {
  it.each([
    ["USD", 2],
    ["EUR", 2],
    ["CAD", 2],
    ["JPY", 0],
    ["KRW", 0],
    ["ISK", 0],
    ["BHD", 3],
    ["KWD", 3],
  ] as const)("%s has %i decimal places", (currency, exponent) => {
    expect(money.exponentOf(currency)).toBe(exponent);
  });

  it("reads codes typed in any case and refuses unknown ones", () => {
    expect(money.parseCurrencyCode(" usd ")).toEqual({
      ok: true,
      currency: "USD",
    });
    expect(money.parseCurrencyCode("XYZ")).toEqual({
      ok: false,
      reason: "unknown_currency",
    });
    expect(money.isCurrencyCode("toString")).toBe(false);
  });
});

describe("rounding half up", () => {
  // Amounts in, minor units out. Floating point gets 2.675 and 1.005 wrong.
  it.each([
    ["0.004", "USD", 0n],
    ["0.005", "USD", 1n],
    ["-0.005", "USD", -1n],
    ["-0.004", "USD", 0n],
    ["1.005", "USD", 101n],
    ["2.675", "USD", 268n],
    ["-2.675", "USD", -268n],
    ["0.8875", "USD", 89n],
    ["1234.5", "JPY", 1235n],
    ["-1234.5", "JPY", -1235n],
    ["1.2345", "BHD", 1235n],
    ["1.2344", "BHD", 1234n],
    ["12", "USD", 1200n],
  ] as const)("%s %s is %i minor units", (amount, currency, minor) => {
    expect(toMinor(decimal(amount), currency)).toBe(minor);
  });

  it.each([
    [1999n, "1.5", 2999n, "1.5 × $19.99 = $29.985, rounds to $29.99"],
    [1000n, "0.08875", 89n, "8.875% tax on $10.00 = $0.8875"],
    [333n, "3", 999n, "3 × $3.33"],
    [-1999n, "1.5", -2999n, "a credit rounds away from zero too"],
    [100n, "0.005", 1n, "half a cent rounds up"],
    [100n, "0.00499999", 0n, "just under half rounds down"],
  ] as const)("%i × %s = %i (%s)", (minor, factor, expected, _why) => {
    expect(multiply(minor, decimal(factor))).toBe(expected);
  });

  it("needs a positive denominator", () => {
    expect(() => money.divideHalfUp(1n, 0n)).toThrow(RangeError);
    expect(() => money.divideHalfUp(1n, -2n)).toThrow(RangeError);
  });
});

describe("parse", () => {
  it.each([
    ["12.50", "USD", 1250n],
    ["1,234.56", "USD", 123456n],
    ["$1,234.56", "USD", 123456n],
    ["-$12.50", "USD", -1250n],
    ["$-12.50", "USD", -1250n],
    ["−12.50", "USD", -1250n],
    ["(12.50)", "USD", -1250n],
    ["($12.50)", "USD", -1250n],
    ["12.50 USD", "USD", 1250n],
    ["usd 12.50", "USD", 1250n],
    ["CA$5", "CAD", 500n],
    ["+7", "USD", 700n],
    [".5", "USD", 50n],
    ["12.5000", "USD", 1250n],
    ["¥1,234", "JPY", 1234n],
    ["1234.00", "JPY", 1234n],
    ["BHD 1.235", "BHD", 1235n],
    ["-0.00", "USD", 0n],
    ["92233720368547758.07", "USD", money.MAX_MINOR],
    ["-92233720368547758.08", "USD", money.MIN_MINOR],
  ] as const)("reads %j in %s as %i", (text, currency, minor) => {
    expect(parse(text, currency)).toEqual({ ok: true, minor });
  });

  it.each([
    ["", "empty"],
    ["   ", "empty"],
    ["abc", "invalid"],
    ["12.", "invalid"],
    [".", "invalid"],
    ["1,23.45", "invalid"],
    ["1234,56", "invalid"],
    ["--12", "invalid"],
    ["-$-12", "invalid"],
    ["(-12)", "invalid"],
    ["12.50-", "invalid"],
    ["€12.50", "invalid"],
    ["1e3", "invalid"],
    ["12.505", "too_many_decimals"],
    ["92233720368547758.08", "out_of_range"],
    ["-92233720368547758.09", "out_of_range"],
  ] as const)("refuses %j as %s", (text, reason) => {
    expect(parse(text, "USD")).toEqual({ ok: false, reason });
  });

  it("refuses decimals a currency doesn't have", () => {
    expect(parse("1234.5", "JPY")).toEqual({
      ok: false,
      reason: "too_many_decimals",
    });
  });
});

describe("format", () => {
  it.each([
    [123456n, "USD", false, "$1,234.56"],
    [-1250n, "USD", false, "-$12.50"],
    [-1250n, "USD", true, "($12.50)"],
    [0n, "USD", false, "$0.00"],
    [5n, "USD", false, "$0.05"],
    [1234n, "JPY", false, "¥1,234"],
    [1235n, "BHD", false, "BHD 1.235"],
    [money.MAX_MINOR, "USD", false, "$92,233,720,368,547,758.07"],
  ] as const)(
    "shows %i %s (accounting %s) as %j",
    (minor, currency, accounting, text) => {
      expect(format(minor, currency, { accounting })).toBe(text);
    },
  );

  it.each([
    [123456n, "USD", "1234.56"],
    [-5n, "USD", "-0.05"],
    [0n, "USD", "0.00"],
    [1234n, "JPY", "1234"],
    [-1n, "BHD", "-0.001"],
  ] as const)(
    "writes %i %s as the exact decimal %j",
    (minor, currency, text) => {
      expect(toDecimalString(minor, currency)).toBe(text);
    },
  );
});
