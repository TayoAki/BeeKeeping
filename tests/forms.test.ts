// Every form in the web app says how it sends. Until React takes over a
// page, the browser submits a form itself, and a form with no method sends
// its fields in the address, which servers write to their logs: a password,
// an address or a name. A form the page handles in the browser (onSubmit)
// posts, so a submit that beats React sends its fields in the body. A
// form that works without JavaScript, such as the audit log's filters, may
// say get when its fields belong in the address.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const web = join(root, "apps/web/src");

function files(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) return files(path);
    return entry.name.endsWith(".tsx") ? [path] : [];
  });
}

/**
 * The opening tag that starts at a <form: up to the first > outside braces,
 * since an attribute such as onSubmit={(event) => ...} holds one.
 */
function openingTag(text: string, start: number): string {
  let depth = 0;
  for (let at = start; at < text.length; at += 1) {
    const char = text[at];
    if (char === "{") depth += 1;
    else if (char === "}") depth -= 1;
    else if (char === ">" && depth === 0) return text.slice(start, at + 1);
  }
  return text.slice(start);
}

/** Each <form ...> opening tag in the web app, with where it is. */
function formTags(): { where: string; tag: string }[] {
  return files(web).flatMap((path) => {
    const text = readFileSync(path, "utf8");
    return [...text.matchAll(/<form\b/g)].map((match) => ({
      where: `${relative(root, path)}:${text.slice(0, match.index).split("\n").length}`,
      tag: openingTag(text, match.index),
    }));
  });
}

describe("forms", () => {
  it("are found, so the checks below look at something", () => {
    expect(formTags().length).toBeGreaterThan(10);
  });

  it("say how they send", () => {
    const missing = formTags()
      .filter(({ tag }) => !/\smethod="(post|get)"/.test(tag))
      .map(({ where }) => where);
    expect(missing).toEqual([]);
  });

  it("post when the page handles them in the browser", () => {
    const getting = formTags()
      .filter(
        ({ tag }) => /\sonSubmit=/.test(tag) && !/\smethod="post"/.test(tag),
      )
      .map(({ where }) => where);
    expect(getting).toEqual([]);
  });
});
