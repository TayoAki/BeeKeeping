// The demo company: a small US design studio, the only books any screenshot,
// video or PR environment shows. `pnpm dev:demo` runs the app on it, PR
// environments load it with `pnpm seed:demo`, and the evidence helper signs
// in as its people. This file says only who and what the company is, so the
// evidence helper can read it without loading the app; seed-demo.ts loads
// it. Its people sign in with one password, DEMO_PASSWORD, which lives in
// the environment and never here.
import type { Role } from "@beekeeping/actions";

export type DemoPerson = {
  readonly role: Extract<Role, "owner" | "bookkeeper" | "viewer">;
  readonly name: string;
  readonly email: string;
};

export const demoCompany = {
  name: "Honeycomb Design Studio (demo)",
  slug: "honeycomb-design-studio-demo",
  homeCurrency: "USD",
  // Addresses under .test, which no mail server delivers to.
  emailFrom: "BeeKeeping <demo@honeycomb-demo.test>",
  people: [
    { role: "owner", name: "Avery Park", email: "avery@honeycomb-demo.test" },
    {
      role: "bookkeeper",
      name: "Blake Ortiz",
      email: "blake@honeycomb-demo.test",
    },
    {
      role: "viewer",
      name: "Casey Moreno",
      email: "casey@honeycomb-demo.test",
    },
  ],
} as const satisfies {
  name: string;
  slug: string;
  homeCurrency: string;
  emailFrom: string;
  people: readonly DemoPerson[];
};

export type DemoRole = (typeof demoCompany.people)[number]["role"];

/** The person evidence signs in as unless it asks for another: the owner. */
export function demoPerson(role: DemoRole = "owner"): DemoPerson {
  const person = demoCompany.people.find((each) => each.role === role);
  if (!person) throw new Error(`The demo company has no ${role}.`);
  return person;
}
