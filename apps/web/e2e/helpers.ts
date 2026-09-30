// Helpers for the end-to-end tests. Every name and address belongs to the
// demo company.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import AxeBuilder from "@axe-core/playwright";
import {
  errors,
  expect,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";

export const password = "correct horse battery staple";

/** A signed-in person's cookies, kept in memory rather than in a file. */
export type SignedIn = Awaited<ReturnType<BrowserContext["storageState"]>>;

/** The first link in the newest email to an address, from the outbox. */
export async function linkFor(to: string): Promise<string> {
  const outbox = process.env.E2E_OUTBOX ?? "";
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const texts = readdirSync(outbox)
      .filter((name) => name.endsWith(".json"))
      .sort()
      .map(
        (name) =>
          JSON.parse(readFileSync(join(outbox, name), "utf8")) as {
            to: string;
            text: string;
          },
      )
      .filter((entry) => entry.to === to)
      .map((entry) => entry.text);
    const link = texts.at(-1)?.match(/https?:\/\/\S+/)?.[0];
    if (link) return link;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`No email to ${to} in the outbox.`);
}

/**
 * Signs up and confirms the address with the password, which signs the
 * person in.
 */
export async function signUp(
  page: Page,
  { name, email }: { name: string; email: string },
): Promise<void> {
  await page.goto("/sign-up");
  await page.getByLabel("Your name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("status")).toContainText("Check your email");
  await page.goto(await linkFor(email));
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Confirm and sign in" }).click();
  await page.waitForURL((url) => url.pathname !== "/confirm-email");
}

/**
 * Waits until React has taken over an element, so the page handles what
 * happens to it. Before that, the browser would submit a form itself.
 */
export async function hydrated(locator: Locator): Promise<void> {
  const element = await locator.elementHandle();
  try {
    await locator
      .page()
      .waitForFunction(
        (node) =>
          node !== null &&
          Object.keys(node).some((key) => key.startsWith("__reactFiber$")),
        element,
      );
  } catch (error) {
    // Only a wait that ran out means the page never came to life. Ctrl-C,
    // which closes the browser, fails the wait too.
    if (!(error instanceof errors.TimeoutError)) throw error;
    throw new Error(
      "The page never came to life: React didn't take over the form, so nothing was submitted.",
      { cause: error },
    );
  }
}

/**
 * Signs in with the password form. When sign-in is refused, it throws with
 * the form's own message rather than wait for a timeout.
 */
export async function signIn(
  page: Page,
  { email, password }: { email: string; password: string },
): Promise<void> {
  await page.goto("/sign-in");
  const form = page.getByRole("form", { name: "With your password" });
  await hydrated(form);
  await form.getByLabel("Email").fill(email);
  await form.getByLabel("Password").fill(password);
  await form.getByRole("button", { name: "Sign in" }).click();
  // Either the page moves on, or the form says why it didn't.
  const alert = form.getByRole("alert");
  const movedOn = page
    .waitForURL((url) => url.pathname !== "/sign-in")
    .then(() => true);
  const refused = alert.waitFor().then(() => false);
  for (const waiting of [movedOn, refused]) waiting.catch(() => undefined);
  if (!(await Promise.race([movedOn, refused]))) {
    throw new Error(
      `The sign-in form says: ${(await alert.innerText()).trim()}`,
    );
  }
}

/** Signs up, confirms the address and creates an organization. */
export async function signUpOwner(
  page: Page,
  { name, email, business }: { name: string; email: string; business: string },
): Promise<void> {
  await signUp(page, { name, email });
  await page.waitForURL("**/organizations/new");
  await page.getByLabel("Business name").fill(business);
  await page.getByLabel("Home currency").selectOption("USD");
  await page.getByRole("button", { name: "Create organization" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: business }),
  ).toBeVisible();
  // The form saved the currency through callAction.
  await expect(page.getByText("Home currency: USD")).toBeVisible();
}

/**
 * Calls Better Auth as the page's signed-in person would, for setting up
 * what a test needs rather than what it checks.
 */
export async function callAuth(
  page: Page,
  path: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const origin = new URL(page.url()).origin;
  const answer = await page.request.post(`/api/auth${path}`, {
    headers: { origin },
    data: body,
  });
  expect(answer.status(), path).toBe(200);
  return (await answer.json()) as Record<string, unknown>;
}

// WCAG 2.2 A and AA, and axe's best practices.
const tags = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22aa",
  "best-practice",
];

/**
 * Runs axe on the page as it is now and expects no violations. With
 * E2E_EVIDENCE set, it also saves a screenshot and adds the result to
 * axe-report.json in that folder.
 */
export async function expectAccessible(page: Page, name: string) {
  // next dev can swap a page's stylesheet as it navigates, and axe on an
  // unstyled page measures sizes and colours the page doesn't have. Every
  // page's body takes its background from the shared stylesheet.
  await page.waitForFunction(
    () =>
      getComputedStyle(document.body).backgroundColor !== "rgba(0, 0, 0, 0)",
  );
  const results = await new AxeBuilder({ page }).withTags(tags).analyze();
  const evidence = process.env.E2E_EVIDENCE;
  if (evidence) {
    mkdirSync(evidence, { recursive: true });
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    await page.screenshot({ path: join(evidence, `${slug}.png`) });
    const report = join(evidence, "axe-report.json");
    let runs: unknown[];
    try {
      runs = JSON.parse(readFileSync(report, "utf8")) as unknown[];
    } catch {
      runs = [];
    }
    runs.push({
      name,
      url: page.url(),
      rulesChecked: results.passes.length + results.violations.length,
      violations: results.violations,
    });
    writeFileSync(report, JSON.stringify(runs, null, 2));
  }
  expect(
    results.violations.map(
      (violation) =>
        `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`,
    ),
    name,
  ).toEqual([]);
}
