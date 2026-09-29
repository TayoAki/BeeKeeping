// The person's theme choice lives in a cookie, so the server renders the
// right theme on the first paint. No cookie means "follow the system".

export type Theme = "light" | "dark";

export const themeCookie = "beekeeping-theme";

/** The theme a cookie asks for, or undefined to follow the system. */
export function parseTheme(value: string | undefined): Theme | undefined {
  return value === "light" || value === "dark" ? value : undefined;
}

const changed = "beekeeping:themechange";

/** Applies a choice at once and remembers it for a year. */
export function chooseTheme(choice: Theme | "system"): void {
  const root = document.documentElement;
  if (choice === "system") {
    delete root.dataset.theme;
    document.cookie = `${themeCookie}=; Path=/; Max-Age=0; SameSite=Lax`;
  } else {
    root.dataset.theme = choice;
    document.cookie = `${themeCookie}=${choice}; Path=/; Max-Age=31536000; SameSite=Lax`;
  }
  window.dispatchEvent(new Event(changed));
}

/** Calls back when the theme on screen may have changed. */
export function watchTheme(callback: () => void): () => void {
  const system = window.matchMedia("(prefers-color-scheme: dark)");
  window.addEventListener(changed, callback);
  system.addEventListener("change", callback);
  return () => {
    window.removeEventListener(changed, callback);
    system.removeEventListener("change", callback);
  };
}

/** The theme on screen now, whether chosen or from the system. */
export function shownTheme(): Theme {
  const chosen = parseTheme(document.documentElement.dataset.theme);
  if (chosen) return chosen;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}
