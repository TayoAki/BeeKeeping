import { describe, expect, it } from "vitest";

import { money } from "../index.ts";

const { format, parse, toDecimalString, toMinor, multiply } = money;

function decimal(text: string) {
  const parsed = money.parseDecimal(text);
  if (!parsed.ok) throw new Error(`bad test decimal ${text}`);
  return parsed.value;
}

describe("currencies", () => {
  // ISO 4217 minor units. Stored amounts depend on these, so a change here
  // must fail a test.
  const iso4217 = {
    AED: 2,
    ARS: 2,
    AUD: 2,
    BHD: 3,
    BRL: 2,
    CAD: 2,
    CHF: 2,
    CLP: 0,
    CNY: 2,
    COP: 2,
    CZK: 2,
    DKK: 2,
    EUR: 2,
    GBP: 2,
    HKD: 2,
    HUF: 2,
    IDR: 2,
    ILS: 2,
    INR: 2,
    ISK: 0,
    JOD: 3,
    JPY: 0,
    KRW: 0,
    KWD: 3,
    MXN: 2,
    MYR: 2,
    NOK: 2,
    NZD: 2,
    OMR: 3,
    PEN: 2,
    PHP: 2,
    PLN: 2,
    SAR: 2,
    SEK: 2,
    SGD: 2,
    THB: 2,
    TND: 3,
    TRY: 2,
    TWD: 2,
    USD: 2,
    ZAR: 2,
  } as const;

  it("has the ISO 4217 exponent for every currency, and no others", () => {
    const exponents = Object.fromEntries(
      money.currencyCodes.map((code) => [code, money.exponentOf(code)]),
    );
    expect(exponents).toEqual(iso4217);
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
    // Rounded once, not digit by digit: 0.0049 must not become 0.005.
    ["0.0049", "USD", 0n],
    ["-0.0049", "USD", 0n],
    ["2.4449", "USD", 244n],
    ["0.49", "JPY", 0n],
  ] as const)("%s %s is %i minor units", (amount, currency, minor) => {
    expect(toMinor(decimal(amount), currency)).toEqual({ ok: true, minor });
  });

  it.each([
    [1999n, "1.5", 2999n, "1.5 × $19.99 = $29.985, rounds to $29.99"],
    [1000n, "0.08875", 89n, "8.875% tax on $10.00 = $0.8875"],
    [333n, "3", 999n, "3 × $3.33"],
    [-1999n, "1.5", -2999n, "a credit rounds away from zero too"],
    [100n, "0.005", 1n, "half a cent rounds up"],
    [100n, "0.00499999", 0n, "just under half rounds down"],
  ] as const)("%i × %s = %i (%s)", (minor, factor, expected, _why) => {
    expect(multiply(minor, decimal(factor))).toEqual({
      ok: true,
      minor: expected,
    });
  });

  it.each([
    ["1000", "0.0449", "USD", 4490n, "1,000 boxes at $0.0449"],
    ["12", "19.9950", "USD", 23994n, "12 at $19.995"],
    ["3", "0.045", "USD", 14n, "3 at $0.045 is $0.135, rounded once"],
    ["-3", "0.045", "USD", -14n, "a credit line rounds away from zero"],
    ["2.5", "1.25", "JPY", 3n, "2.5 at ¥1.25 is ¥3.125"],
  ] as const)(
    "%s × %s %s rounds once to %i (%s)",
    (quantity, price, currency, minor, _why) => {
      expect(
        toMinor(money.times(decimal(quantity), decimal(price)), currency),
      ).toEqual({
        ok: true,
        minor,
      });
    },
  );

  it("refuses results too large for a Postgres bigint", () => {
    expect(toMinor(decimal("92233720368547758.08"), "USD")).toEqual({
      ok: false,
      reason: "out_of_range",
    });
    expect(multiply(1000n, decimal("99999999999999999999"))).toEqual({
      ok: false,
      reason: "out_of_range",
    });
    expect(toMinor(decimal("92233720368547758.07"), "USD")).toEqual({
      ok: true,
      minor: money.MAX_MINOR,
    });
    expect(toMinor(decimal("-92233720368547758.08"), "USD")).toEqual({
      ok: true,
      minor: money.MIN_MINOR,
    });
    expect(toMinor(decimal("-92233720368547758.09"), "USD")).toEqual({
      ok: false,
      reason: "out_of_range",
    });
    expect(multiply(-1000n, decimal("99999999999999999999"))).toEqual({
      ok: false,
      reason: "out_of_range",
    });
  });

  it("refuses a Decimal with a negative or fractional scale", () => {
    expect(() => toMinor({ units: 1n, scale: -1 }, "USD")).toThrow(RangeError);
    expect(() => multiply(100n, { units: 1n, scale: 1.5 })).toThrow(RangeError);
    expect(() =>
      money.times({ units: 1n, scale: 0.5 }, { units: 1n, scale: 0.5 }),
    ).toThrow(RangeError);
  });

  it("reads decimals with or without a leading digit", () => {
    expect(money.parseDecimal(".5")).toEqual({
      ok: true,
      value: { units: 5n, scale: 1 },
    });
    expect(money.parseDecimal("-0.045")).toEqual({
      ok: true,
      value: { units: -45n, scale: 3 },
    });
    for (const text of [".", "", "-", "1.", "1e3", "1,000"]) {
      expect(money.parseDecimal(text)).toEqual({
        ok: false,
        reason: "invalid_decimal",
      });
    }
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
    ["\u221212.50", "USD", -1250n],
    ["(12.50)", "USD", -1250n],
    ["($12.50)", "USD", -1250n],
    ["12.50 USD", "USD", 1250n],
    ["usd 12.50", "USD", 1250n],
    ["CA$5", "CAD", 500n],
    ["$5", "CAD", 500n],
    ["12.50 usd", "USD", 1250n],
    ["+7", "USD", 700n],
    [".5", "USD", 50n],
    ["12.5000", "USD", 1250n],
    ["¥1,234", "JPY", 1234n],
    ["1234.00", "JPY", 1234n],
    ["BHD 1.235", "BHD", 1235n],
    ["-0.00", "USD", 0n],
    ["0", "USD", 0n],
    ["0.5", "USD", 50n],
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
    ["0,500", "invalid"],
    ["0,000,001", "invalid"],
    ["$", "invalid"],
    ["-", "invalid"],
    ["()", "invalid"],
    ["(-)", "invalid"],
    ["12.50)", "invalid"],
    ["(12.50", "invalid"],
    ["(+12)", "invalid"],
    ["12.505", "too_many_decimals"],
    ["92233720368547758.08", "out_of_range"],
    ["-92233720368547758.09", "out_of_range"],
  ] as const)("refuses %j as %s", (text, reason) => {
    expect(parse(text, "USD")).toEqual({ ok: false, reason });
  });

  it("refuses a mark written with an abbreviation point", () => {
    // Written this way, the amount meant is Rp 500 or 50 kroner, not 0.50.
    expect(parse("Rp.500", "IDR")).toEqual({ ok: false, reason: "invalid" });
    expect(parse("kr.50", "DKK")).toEqual({ ok: false, reason: "invalid" });
    expect(parse("$.50", "USD")).toEqual({ ok: true, minor: 50n });
    expect(parse("CA$.50", "CAD")).toEqual({ ok: true, minor: 50n });
    expect(parse("Rp500", "IDR")).toEqual({ ok: true, minor: 50000n });
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
    [1235n, "BHD", false, "BHD\u00a01.235"],
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
