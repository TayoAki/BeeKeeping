import { describe, expect, it } from "vitest";

import nextConfig from "../next.config.ts";

describe("response headers", () => {
  it("keep the reset and confirmation pages' tokens out of Referer, and no later rule overrides that", async () => {
    // Next.js lets the last matching rule set a header, so a site-wide rule
    // after this one would bring the leak back.
    const rules = (await nextConfig.headers?.()) ?? [];
    const policies = rules.filter((rule) =>
      rule.headers.some(({ key }) => key.toLowerCase() === "referrer-policy"),
    );
    expect(policies.at(-1)).toMatchObject({
      source: "/:page(reset-password|confirm-email)",
      headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
    });
  });
});
