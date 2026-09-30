import { describe, expect, it } from "vitest";

import {
  countResults,
  firstLine,
  renderReport,
  slug,
  type Line,
} from "./evidence-report.ts";

const lines: Line[] = [
  { kind: "step", at: 200, name: "A signed-out visitor opens BeeKeeping" },
  {
    kind: "check",
    at: 1_700,
    name: "the visitor lands on the sign-in page",
    result: "passed",
    shot: "01-the-visitor-lands-on-the-sign-in-page-passed.png",
  },
  {
    kind: "check",
    at: 9_050,
    name: "the members page answers 403",
    result: "failed",
    reason: "expected 403, got 200",
  },
  {
    kind: "check",
    at: undefined,
    name: "two-factor codes",
    result: "untested",
    reason: "the demo people have none",
  },
];

describe("assertions.md", () => {
  it("names the commit, the app and the counts, then one line per step and check", () => {
    expect(
      renderReport({
        title: "Signing in to the demo company",
        commit: "Commit 0fad824 on task/p0.8",
        baseUrl: "http://localhost:3000",
        startedAt: new Date("2026-09-30T00:25:16.457Z"),
        lines,
      }),
    ).toBe(
      [
        "# Signing in to the demo company",
        "",
        "Commit 0fad824 on task/p0.8, against http://localhost:3000. Run at 2026-09-30T00:25:16.457Z: 1 passed, 1 failed, 1 untested.",
        "",
        "Times are from the start of walkthrough.webm.",
        "",
        "- test_start at 0.2s: A signed-out visitor opens BeeKeeping",
        "  - assertion at 1.7s: the visitor lands on the sign-in page: passed [01-the-visitor-lands-on-the-sign-in-page-passed.png]",
        "  - assertion at 9.1s: the members page answers 403: failed (expected 403, got 200)",
        "  - assertion: two-factor codes: untested (the demo people have none)",
        "",
      ].join("\n"),
    );
  });

  it("counts only checks", () => {
    expect(countResults(lines)).toEqual({ passed: 1, failed: 1, untested: 1 });
  });

  it("names screenshots in lowercase words, 60 characters at most", () => {
    expect(slug("The home page shows the owner's role!")).toBe(
      "the-home-page-shows-the-owner-s-role",
    );
    expect(slug("x".repeat(80))).toHaveLength(60);
  });

  it("keeps an error's first line only", () => {
    expect(
      firstLine(new Error("Timeout 20000ms exceeded.\n  at page.goto")),
    ).toBe("Timeout 20000ms exceeded.");
    expect(firstLine("plain text")).toBe("plain text");
  });
});
