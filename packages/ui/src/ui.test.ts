import { describe, expect, it } from "vitest";

import { matchCommands, type Command } from "./command-palette.tsx";
import { parseTheme } from "./theme.ts";
import { toastDuration } from "./toast.tsx";

const command = (label: string, group: string, keywords?: string): Command => ({
  id: label,
  label,
  group,
  keywords,
  run: () => {},
});

describe("matchCommands", () => {
  const commands = [
    command("Members", "Go to"),
    command("Your account", "Go to"),
    command("Dark theme", "Theme"),
    command("Sign out", "Account", "log out"),
  ];

  it("lists every command for an empty search", () => {
    expect(matchCommands(commands, "  ")).toHaveLength(4);
  });

  it("finds a command by its words in any order, in any case", () => {
    expect(matchCommands(commands, "THEME dark").map((c) => c.label)).toEqual([
      "Dark theme",
    ]);
  });

  it("finds a command by its group or its keywords", () => {
    expect(matchCommands(commands, "go to").map((c) => c.label)).toEqual([
      "Members",
      "Your account",
    ]);
    expect(matchCommands(commands, "log out").map((c) => c.label)).toEqual([
      "Sign out",
    ]);
  });

  it("finds nothing when a word matches nothing", () => {
    expect(matchCommands(commands, "members payroll")).toEqual([]);
  });
});

describe("toastDuration", () => {
  it("gives a short message 3 seconds", () => {
    expect(toastDuration("Saved.", "success")).toBe(3_000);
  });

  it("adds reading time for each character past 40", () => {
    expect(toastDuration("x".repeat(90), "info")).toBe(3_000 + 60 * 50);
  });

  it("keeps an error at least 6 seconds, and nothing past 15", () => {
    expect(toastDuration("Failed.", "error")).toBe(6_000);
    expect(toastDuration("x".repeat(1_000), "info")).toBe(15_000);
  });
});

describe("parseTheme", () => {
  it("reads light and dark, and follows the system for anything else", () => {
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme("dark")).toBe("dark");
    expect(parseTheme(undefined)).toBeUndefined();
    expect(parseTheme("sepia")).toBeUndefined();
  });
});
