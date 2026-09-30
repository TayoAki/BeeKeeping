// axe on every page and on each part of the shell that opens, in the light
// theme and in the dark one: from the system, and chosen on a light system.
import { expect, test, type Browser, type Page } from "@playwright/test";

import {
  callAuth,
  expectAccessible,
  linkFor,
  password,
  signUp,
  signUpOwner,
  type SignedIn,
} from "./helpers.ts";

test.describe.configure({ mode: "serial" });

// The owner's cookies, kept in memory for this file's tests.
let signedIn: SignedIn;
const owner = { name: "Casey Moreno", email: "casey.axe@honeycomb-demo.test" };
const business = "Honeycomb Design Studio (demo)";
const second = "Second Studio (demo)";

test.beforeAll(async ({ browser }) => {
  // A new person: no session yet, whatever the tests below use.
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();
  await signUpOwner(page, { ...owner, business });
  // A second organization, so the switcher has somewhere to go and a new
  // session has to choose.
  await callAuth(page, "/organization/create", {
    name: second,
    slug: "axe-second-studio",
    keepCurrentActiveOrganization: true,
  });
  signedIn = await context.storageState();
  await context.close();
});

/** A page signed in as the owner, in a theme of the system's. */
async function ownerPage(browser: Browser, theme: "light" | "dark") {
  const context = await browser.newContext({
    storageState: signedIn,
    colorScheme: theme,
  });
  return { context, page: await context.newPage() };
}

async function expectHeading(page: Page, heading: string) {
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
}

for (const theme of ["light", "dark"] as const) {
  test.describe(`the ${theme} theme`, () => {
    test.use({ colorScheme: theme });

    test("signed-out pages", async ({ page }) => {
      for (const [path, heading] of [
        ["/sign-in", "Sign in to BeeKeeping"],
        ["/sign-up", "Create your BeeKeeping account"],
        ["/sign-in/two-factor", "Enter your code"],
        ["/confirm-email?token=not-a-real-token", "Confirm your email"],
        ["/confirm-email", "Confirm your email"],
        ["/forgot-password", "Reset your password"],
        ["/reset-password", "Choose a new password"],
        ["/invitations/none", "You're invited to BeeKeeping"],
        ["/no-such-page", "There's no page here"],
      ] as const) {
        await page.goto(path);
        await expectHeading(page, heading);
        await expectAccessible(page, `${theme} ${path}`);
      }
    });

    test("signed-in pages", async ({ browser }) => {
      const { context, page } = await ownerPage(browser, theme);
      for (const [path, heading] of [
        ["/", business],
        ["/settings/members", "Members"],
        ["/settings/account", "Your account"],
        ["/settings/audit", "Audit log"],
        ["/organizations/new", "Set up your business"],
        ["/invitations/none", "This invitation isn't available"],
      ] as const) {
        await page.goto(path);
        await expectHeading(page, heading);
        await expectAccessible(page, `${theme} signed in ${path}`);
      }
      // The audit log names the owner who set the home currency.
      await page.goto("/settings/audit");
      await expect(
        page
          .getByRole("row")
          .filter({ hasText: "Organization settings, created" }),
      ).toContainText(owner.name);
      // At a phone's width a table scrolls in its own box, which a keyboard
      // can reach, and the page itself doesn't scroll sideways.
      await page.setViewportSize({ width: 390, height: 800 });
      for (const [path, heading] of [
        ["/settings/audit", "Audit log"],
        ["/settings/members", "Members"],
      ] as const) {
        await page.goto(path);
        await expectHeading(page, heading);
        await expectAccessible(page, `${theme} signed in ${path} at 390px`);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
          `${path} scrolls sideways`,
        ).toBe(true);
      }
      await context.close();
    });

    test("the command palette, the organization list and a toast", async ({
      browser,
    }) => {
      const { context, page } = await ownerPage(browser, theme);
      await page.goto("/");
      await page.getByRole("button", { name: /Commands/ }).click();
      await expect(
        page.getByRole("dialog", { name: "Commands" }),
      ).toBeVisible();
      await page.getByRole("combobox", { name: "Search commands" }).fill("go");
      await expectAccessible(page, `${theme} command palette`);
      await page.keyboard.press("Escape");

      const switcher = page.locator(".switcher summary");
      await switcher.click();
      const list = page.getByRole("list", { name: "Your organizations" });
      await expect(list).toBeVisible();
      await expectAccessible(page, `${theme} organization list`);

      await list.getByRole("button", { name: second }).click();
      await expect(
        page.getByRole("status").filter({ hasText: "Switched to" }),
      ).toContainText(`Switched to ${second}.`);
      await expectAccessible(page, `${theme} toast`);
      // Back to the first, which the other tests expect.
      await switcher.click();
      await list.getByRole("button", { name: business }).click();
      await expectHeading(page, business);
      await context.close();
    });

    test("a new session that has to choose an organization", async ({
      browser,
    }) => {
      const context = await browser.newContext({ colorScheme: theme });
      const page = await context.newPage();
      await page.goto("/sign-in");
      await page.locator("#email").fill(owner.email);
      await page.locator("#password").fill(password);
      await page.getByRole("button", { name: "Sign in" }).click();
      await expectHeading(page, "Choose an organization");
      await expectAccessible(page, `${theme} choose an organization`);
      await context.close();
    });

    test("an invitation, and the members page refused to a bookkeeper", async ({
      browser,
    }) => {
      const invitee = {
        name: "Blake Ortiz",
        email: `blake.${theme}@honeycomb-demo.test`,
      };
      const { context, page } = await ownerPage(browser, theme);
      await page.goto("/");
      // The shell offers the admin pages to the owner, and below to no
      // bookkeeper. The navigation and the palette share one list.
      const ownerNav = page.getByRole("navigation", { name: "Main" });
      for (const place of ["Members", "Audit log"]) {
        await expect(ownerNav.getByRole("link", { name: place })).toBeVisible();
      }
      await callAuth(page, "/organization/invite-member", {
        email: invitee.email,
        role: "bookkeeper",
      });
      const invitation = await linkFor(invitee.email);
      await context.close();

      const joining = await browser.newContext({ colorScheme: theme });
      const page2 = await joining.newPage();
      await signUp(page2, invitee);
      await page2.goto(invitation);
      await expectHeading(page2, `Join ${business}`);
      await expectAccessible(page2, `${theme} invitation to join`);
      await page2.getByRole("button", { name: "Accept and join" }).click();
      await expectHeading(page2, business);
      const nav = page2.getByRole("navigation", { name: "Main" });
      await expect(
        nav.getByRole("link", { name: "Your account" }),
      ).toBeVisible();
      for (const place of ["Members", "Audit log"]) {
        await expect(nav.getByRole("link", { name: place })).toHaveCount(0);
      }

      const refused = await page2.goto("/settings/members");
      expect(refused?.status()).toBe(403);
      await expectHeading(page2, "You can't open this page");
      await expect(page2).toHaveTitle("Not allowed · BeeKeeping");
      await expectAccessible(page2, `${theme} members page refused`);
      const log = await page2.goto("/settings/audit");
      expect(log?.status()).toBe(403);
      await expect(page2).toHaveTitle("Not allowed · BeeKeeping");
      await joining.close();
    });
  });
}

test("the dark theme chosen on a light system", async ({ browser }) => {
  const { context, page } = await ownerPage(browser, "light");
  const url = new URL(test.info().project.use.baseURL ?? "");
  await context.addCookies([
    {
      name: "beekeeping-theme",
      value: "dark",
      domain: url.hostname,
      path: "/",
    },
  ]);
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  // The page turned dark, not only its attribute: --paper's dark value.
  await expect(page.locator("body")).toHaveCSS(
    "background-color",
    "rgb(13, 17, 23)",
  );
  await expectAccessible(page, "chosen dark home");
  await page.getByRole("button", { name: /Commands/ }).click();
  await page.getByRole("combobox", { name: "Search commands" }).fill("theme");
  await expectAccessible(page, "chosen dark command palette");
  await context.close();
});
