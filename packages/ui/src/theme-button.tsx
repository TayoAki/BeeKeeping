"use client";

import { useSyncExternalStore } from "react";

import { chooseTheme, shownTheme, watchTheme, type Theme } from "./theme.ts";

/**
 * A toggle between the light and dark themes. It's pressed when the dark
 * theme is on screen, whether chosen or from the system. The server can't
 * see the system's preference, so with no choice it leaves the pressed
 * state out until the page runs in the browser, rather than guess.
 */
export function ThemeButton({
  chosen,
  onChange,
}: {
  chosen: Theme | undefined;
  onChange?: (theme: Theme) => void;
}) {
  const theme = useSyncExternalStore<Theme | undefined>(
    watchTheme,
    shownTheme,
    () => chosen,
  );
  return (
    <button
      type="button"
      className="secondary"
      aria-pressed={theme === undefined ? undefined : theme === "dark"}
      onClick={() => {
        const next: Theme = theme === "dark" ? "light" : "dark";
        chooseTheme(next);
        onChange?.(next);
      }}
    >
      Dark theme
    </button>
  );
}
