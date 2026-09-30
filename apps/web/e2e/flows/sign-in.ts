// Evidence for signing in to the demo company: its owner signs in with the
// password, lands on the company's home page, opens the members page and
// signs out, then the bookkeeper signs in and gets no members page.
//
//   pnpm evidence sign-in --task <task>
import { expect } from "@playwright/test";

import { demoCompany, demoPerson } from "../../scripts/demo-company.ts";
import type { Flow } from "../evidence.ts";

const flow: Flow = {
  title: "Signing in to the demo company",
  async run({ page, testStart, assertion, untested, signIn }) {
    testStart("A signed-out visitor opens BeeKeeping");
    await page.goto("/");
    await assertion(
      "the visitor lands on the sign-in page",
      async () => {
        await page.waitForURL("**/sign-in");
        await expect(
          page.getByRole("heading", {
            level: 1,
            name: "Sign in to BeeKeeping",
          }),
        ).toBeVisible();
      },
      { shot: true },
    );

    const owner = demoPerson("owner");
    testStart(`${owner.name}, the owner, signs in with the password`);
    await signIn("owner");
    await assertion(
      "the home page shows the demo company, the owner's role and the home currency",
      async () => {
        await expect(
          page.getByRole("heading", { level: 1, name: demoCompany.name }),
        ).toBeVisible();
        await expect(page.getByText("Your role here: owner")).toBeVisible();
        await expect(
          page.getByText(`Home currency: ${demoCompany.homeCurrency}`),
        ).toBeVisible();
      },
      { shot: true },
    );
    await assertion(
      "the members page lists the demo company's people with their roles",
      async () => {
        await page
          .getByRole("navigation", { name: "Main" })
          .getByRole("link", { name: "Members" })
          .click();
        await page.waitForURL("**/settings/members");
        for (const person of demoCompany.people) {
          await expect(
            page.getByRole("row").filter({ hasText: person.email }),
          ).toContainText(person.role);
        }
      },
      { shot: true },
    );
    await assertion("signing out returns to the sign-in page", async () => {
      await page.getByRole("button", { name: "Sign out" }).click();
      await page.waitForURL("**/sign-in");
    });

    const bookkeeper = demoPerson("bookkeeper");
    testStart(`${bookkeeper.name}, the bookkeeper, signs in`);
    await signIn("bookkeeper");
    await assertion(
      "the home page shows the bookkeeper's role and no Members link",
      async () => {
        await expect(
          page.getByText("Your role here: bookkeeper"),
        ).toBeVisible();
        await expect(
          page
            .getByRole("navigation", { name: "Main" })
            .getByRole("link", { name: "Members" }),
        ).toHaveCount(0);
      },
      { shot: true },
    );
    await assertion(
      "the members page answers 403 to the bookkeeper",
      async () => {
        const answer = await page.goto("/settings/members");
        expect(answer?.status()).toBe(403);
      },
    );

    untested(
      "two-factor codes and magic links",
      "the demo people have no second factor, and links need the outbox; apps/web/src/server/auth.test.ts covers both",
    );
  },
};

export default flow;
