export type CurrencyOption = { readonly code: string; readonly name: string };

/** The home currency picker. Nothing is chosen until the person chooses. */
export function CurrencyField({ options }: { options: CurrencyOption[] }) {
  return (
    <>
      <label htmlFor="home-currency">Home currency</label>
      <select
        id="home-currency"
        name="homeCurrency"
        defaultValue=""
        aria-describedby="home-currency-hint"
        required
      >
        <option value="" disabled>
          Choose a currency
        </option>
        {options.map(({ code, name }) => (
          <option key={code} value={code}>
            {code}: {name}
          </option>
        ))}
      </select>
      <p id="home-currency-hint" className="hint">
        The books are kept in this currency. It can&apos;t change later.
      </p>
    </>
  );
}
