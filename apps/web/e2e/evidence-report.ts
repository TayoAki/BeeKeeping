// assertions.md, the evidence helper's record of a run: the commit and branch
// it tested, then one line per step (test_start) and per check (assertion),
// each check passed, failed or untested with a reason. Plain functions, so a
// test checks the format without a browser.

export type Result = "passed" | "failed" | "untested";

/** One line of assertions.md: a step, or a check within it. */
export type Line =
  | { readonly kind: "step"; readonly at: number; readonly name: string }
  | {
      readonly kind: "check";
      /** Milliseconds from the start of the video, unless untested. */
      readonly at: number | undefined;
      readonly name: string;
      readonly result: Result;
      readonly reason?: string | undefined;
      readonly shot?: string | undefined;
    };

export type Report = {
  readonly title: string;
  /** Such as "Commit 0fad824 on task/p0.8". */
  readonly commit: string;
  readonly baseUrl: string;
  readonly startedAt: Date;
  readonly lines: readonly Line[];
};

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

/** How many checks passed, failed and went untested. */
export function countResults(lines: readonly Line[]): Record<Result, number> {
  const counts: Record<Result, number> = { passed: 0, failed: 0, untested: 0 };
  for (const line of lines) if (line.kind === "check") counts[line.result] += 1;
  return counts;
}

export function renderReport(report: Report): string {
  const counts = countResults(report.lines);
  const body = report.lines.map((line) => {
    if (line.kind === "step") {
      return `- test_start at ${seconds(line.at)}: ${line.name}`;
    }
    const at = line.at === undefined ? "" : ` at ${seconds(line.at)}`;
    const reason = line.reason ? ` (${line.reason})` : "";
    const shot = line.shot ? ` [${line.shot}]` : "";
    return `  - assertion${at}: ${line.name}: ${line.result}${reason}${shot}`;
  });
  return [
    `# ${report.title}`,
    "",
    `${report.commit}, against ${report.baseUrl}. Run at ${report.startedAt.toISOString()}: ${counts.passed} passed, ${counts.failed} failed, ${counts.untested} untested.`,
    "",
    "Times are from the start of walkthrough.webm.",
    "",
    ...body,
    "",
  ].join("\n");
}

/** A file name's middle part: lowercase words joined by hyphens. */
export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

/** Only the first line of an error's message, which is the useful part. */
export function firstLine(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split("\n")[0] ?? "";
}
