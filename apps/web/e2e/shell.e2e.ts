// The app shell with a keyboard: the skip link, the command palette, the
// organization switcher, toasts and the theme.
import { expect, test, type Page } from "@playwright/test";

import {
  callAuth,
  password,
  signIn,
  signUpOwner,
  type SignedIn,
} from "./helpers.ts";

test.describe.configure({ mode: "serial" });

// The signed-in person's cookies, kept in memory for this file's tests.
let signedIn: SignedIn;
const owner = { name: "Avery Park", email: "avery.shell@honeycomb-demo.test" };
const first = "Honeycomb Design Studio (demo)";

test.beforeAll(async ({ browser }) => {
  // A new person: no session yet, whatever the tests below use.
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();
  await signUpOwner(page, { ...owner, business: first });
  signedIn = await context.storageState();
  await context.close();
});

// Each test starts signed in, with the cookies beforeAll kept.
test.beforeEach(async ({ context }) => {
  await context.addCookies(signedIn.cookies);
});

/**
 * Opens a signed-in page and waits until the shell answers the keyboard.
 * Keys pressed before React hydrates the page do nothing, so this presses
 * Ctrl+K until the palette opens, then closes it.
 */
async function openShell(page: Page, path = "/") {
  await page.goto(path);
  const palette = page.getByRole("dialog", { name: "Commands" });
  await expect(async () => {
    await page.keyboard.press("Control+k");
    await expect(palette).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await page.keyboard.press("Escape");
  await expect(palette).toBeHidden();
}

/** A short description of whatever has focus. */
function focused(page: Page) {
  return page.evaluate(() => {
    const element = document.activeElement;
    return {
      tag: element?.tagName ?? "",
      id: element?.id ?? "",
      text: (element?.textContent ?? "").trim(),
      inDialog: Boolean(element?.closest("dialog[open]")),
    };
  });
}

test("the first Tab reaches the skip link, which moves focus to the page's content", async ({
  page,
}) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  expect(await focused(page)).toMatchObject({ text: "Skip to content" });
  await expect(
    page.getByRole("link", { name: "Skip to content" }),
  ).toBeInViewport();
  await page.keyboard.press("Enter");
  expect(await focused(page)).toMatchObject({ tag: "MAIN", id: "main" });
});

test("the skip link leaves the address alone, so Back still shows the page before", async ({
  page,
}) => {
  await openShell(page);
  await page.getByRole("link", { name: "Skip to content" }).focus();
  await page.keyboard.press("Enter");
  expect(await focused(page)).toMatchObject({ tag: "MAIN", id: "main" });
  expect(new URL(page.url()).hash).toBe("");
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Your account" })
    .click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Your account" }),
  ).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole("heading", { level: 1, name: first }),
  ).toBeVisible();
});

test("the main navigation marks the page that's open", async ({ page }) => {
  await page.goto("/settings/account");
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link", { name: "Your account" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(nav.getByRole("link", { name: "Home" })).not.toHaveAttribute(
    "aria-current",
  );
});

test("Ctrl+K opens the palette, typing narrows it, and Enter runs a command", async ({
  page,
}) => {
  await openShell(page);
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "Commands" });
  await expect(palette).toBeVisible();
  const search = page.getByRole("combobox", { name: "Search commands" });
  await expect(search).toBeFocused();
  await search.fill("your account");
  await expect(page.getByRole("option")).toHaveText([/Your account/]);
  await page.keyboard.press("Enter");
  await page.waitForURL("**/settings/account");
  await expect(palette).toBeHidden();
});

test("arrow keys move through the commands, and the search box keeps focus", async ({
  page,
}) => {
  await openShell(page);
  await page.keyboard.press("Control+k");
  const search = page.getByRole("combobox", { name: "Search commands" });
  const firstId = await search.getAttribute("aria-activedescendant");
  await page.keyboard.press("ArrowDown");
  const secondId = await search.getAttribute("aria-activedescendant");
  expect(secondId).not.toBe(firstId);
  await expect(page.locator(`[id="${secondId}"]`)).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(search).toBeFocused();
});

test("the highlighted command stays in view as the keys move through a long list", async ({
  browser,
}) => {
  // Someone with five organizations, whose palette lists thirteen
  // commands, more than the list shows at once.
  const context = await browser.newContext();
  const page = await context.newPage();
  await signUpOwner(page, {
    name: "Riley Chen",
    email: "riley.palette@honeycomb-demo.test",
    business: "Riley's Studio (demo)",
  });
  for (const n of [2, 3, 4, 5]) {
    await callAuth(page, "/organization/create", {
      name: `Client ${n} Studio (demo)`,
      slug: `riley-client-${n}`,
      keepCurrentActiveOrganization: true,
    });
  }
  await openShell(page);
  await page.keyboard.press("Control+k");
  const search = page.getByRole("combobox", { name: "Search commands" });
  await expect(page.getByRole("option")).toHaveCount(13);
  // Nine-tenths of a command in view is all of it but a rounded pixel. With
  // nothing scrolling it, the last command had none in view.
  const highlighted = async () =>
    page.locator(
      `[id="${await search.getAttribute("aria-activedescendant")}"]`,
    );
  await page.keyboard.press("End");
  await expect(await highlighted()).toHaveText(/Sign out/);
  await expect(await highlighted()).toBeInViewport({ ratio: 0.9 });
  await page.keyboard.press("Home");
  await expect(await highlighted()).toHaveText(/Home/);
  await expect(await highlighted()).toBeInViewport({ ratio: 0.9 });
  for (let step = 0; step < 12; step += 1) {
    await page.keyboard.press("ArrowDown");
    await expect(await highlighted()).toBeInViewport({ ratio: 0.9 });
  }
  await context.close();
});

test("the palette opens again straight after Escape closes it", async ({
  page,
}) => {
  await openShell(page);
  const palette = page.getByRole("dialog", { name: "Commands" });
  for (let round = 0; round < 5; round += 1) {
    await page.keyboard.press("Control+k");
    await expect(palette).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(palette).toBeHidden();
  }
});

test("the page behind the palette can't take focus, and Escape returns it to the button", async ({
  page,
}) => {
  await openShell(page);
  const button = page.getByRole("button", { name: /Commands/ });
  await button.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Commands" })).toBeVisible();
  // A modal dialog makes the page behind it inert. Tab goes round the
  // dialog's controls and may leave for the browser's own, which leaves no
  // element of the page focused, but it never reaches the page behind.
  for (let step = 0; step < 6; step += 1) {
    await page.keyboard.press("Tab");
    const now = await focused(page);
    expect(now.inDialog || now.tag === "BODY", JSON.stringify(now)).toBe(true);
  }
  await page.getByRole("link", { name: "Members" }).focus();
  expect((await focused(page)).text).not.toBe("Members");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Commands" })).toBeHidden();
  await expect(button).toBeFocused();
});

test("the switcher lists the organizations, and switching says so in a toast", async ({
  page,
}) => {
  await openShell(page);
  const switcher = page.locator(".switcher summary");
  await switcher.click();
  await page.getByRole("link", { name: "New organization" }).click();
  await page.waitForURL("**/organizations/new");
  await page.getByLabel("Business name").fill("Second Studio (demo)");
  await page.getByLabel("Home currency").selectOption("EUR");
  await page.getByRole("button", { name: "Create organization" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Second Studio (demo)" }),
  ).toBeVisible();

  await switcher.click();
  const list = page.getByRole("list", { name: "Your organizations" });
  await expect(list.getByText("Second Studio (demo)")).toHaveAttribute(
    "aria-current",
    "true",
  );
  await list.getByRole("button", { name: first }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Switched to" }),
  ).toContainText(`Switched to ${first}.`);
  await expect(
    page.getByRole("heading", { level: 1, name: first }),
  ).toBeVisible();
  // The shell, not only the page, names the organization now.
  await expect(switcher).toContainText(first);
});

test("the palette switches organization, and says so in a toast", async ({
  page,
}) => {
  await page.goto("/");
  await callAuth(page, "/organization/create", {
    name: "Palette Studio (demo)",
    slug: "palette-studio",
  });
  await openShell(page);
  await expect(
    page.getByRole("heading", { level: 1, name: "Palette Studio (demo)" }),
  ).toBeVisible();
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox", { name: "Search commands" }).fill(first);
  await expect(page.getByRole("option")).toContainText([first]);
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("status").filter({ hasText: "Switched to" }),
  ).toContainText(`Switched to ${first}.`);
  await expect(
    page.getByRole("heading", { level: 1, name: first }),
  ).toBeVisible();
  await expect(page.locator(".switcher summary")).toContainText(first);

  // Dismissing the toast by keyboard hands focus to the page's content.
  const dismiss = page.getByRole("button", { name: "Dismiss notification" });
  await dismiss.focus();
  await page.keyboard.press("Enter");
  await expect(dismiss).toHaveCount(0);
  expect(await focused(page)).toMatchObject({ tag: "MAIN", id: "main" });
});

test("the palette signs out, and only this browser", async ({ browser }) => {
  // A session of its own, so the one the other tests share survives.
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, { email: owner.email, password });
  await page.waitForURL((url) => url.pathname === "/");
  await openShell(page);
  await page.keyboard.press("Control+k");
  await page
    .getByRole("combobox", { name: "Search commands" })
    .fill("sign out");
  await page.keyboard.press("Enter");
  await page.waitForURL("**/sign-in");
  await page.goto("/settings/account");
  await page.waitForURL("**/sign-in**");
  await context.close();

  // The session the other tests share still works.
  const other = await browser.newContext({ storageState: signedIn });
  const still = await other.newPage();
  await still.goto("/settings/account");
  await expect(
    still.getByRole("heading", { level: 1, name: "Your account" }),
  ).toBeVisible();
  await other.close();
});

test("Escape closes the switcher and puts focus back on it", async ({
  page,
}) => {
  await openShell(page);
  const switcher = page.locator(".switcher summary");
  await switcher.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("list", { name: "Your organizations" }),
  ).toBeVisible();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("list", { name: "Your organizations" }),
  ).toBeHidden();
  await expect(switcher).toBeFocused();
});

test("the theme button switches to dark and remembers it", async ({ page }) => {
  await openShell(page);
  const dark = page.getByRole("button", { name: "Dark theme" });
  await expect(dark).toHaveAttribute("aria-pressed", "false");
  await dark.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  // The page turned dark, not only its attribute: --paper's dark value.
  await expect(page.locator("body")).toHaveCSS(
    "background-color",
    "rgb(13, 17, 23)",
  );
  await expect(dark).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(
    page.getByRole("button", { name: "Dark theme" }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("the theme button claims no state it can't know before the page runs", async ({
  browser,
}) => {
  // With JavaScript off, the server can't see a dark system, so the button
  // says nothing about pressed. A chosen theme it knows from the cookie.
  const context = await browser.newContext({
    javaScriptEnabled: false,
    colorScheme: "dark",
  });
  await context.addCookies(signedIn.cookies);
  const page = await context.newPage();
  await page.goto("/");
  const dark = page.getByRole("button", { name: "Dark theme" });
  await expect(dark).not.toHaveAttribute("aria-pressed");
  const url = new URL(page.url());
  await context.addCookies([
    {
      name: "beekeeping-theme",
      value: "dark",
      domain: url.hostname,
      path: "/",
    },
  ]);
  await page.reload();
  await expect(dark).toHaveAttribute("aria-pressed", "true");
  await context.close();
});

test("the palette follows the system theme again", async ({ page }) => {
  await openShell(page);
  // Choose dark first, so the command has something to undo.
  await page.getByRole("button", { name: "Dark theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox", { name: "Search commands" }).fill("system");
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);
  // The cookie went too, so a reload follows the system as well.
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);
});
