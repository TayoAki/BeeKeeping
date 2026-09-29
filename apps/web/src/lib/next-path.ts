const site = "https://beekeeping.invalid";

/**
 * True for a character a browser treats as a slash or drops from a URL: a
 * backslash, a control character such as a tab, or a percent-encoded slash
 * or backslash.
 */
function looksLikeAnotherSite(path: string): boolean {
  if (/%2f|%5c/i.test(path)) return true;
  for (const character of path) {
    const code = character.codePointAt(0) ?? 0;
    if (character === "\\" || code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * Keeps a "next" path on this site, so a link can't send people elsewhere
 * once they sign in. Browsers read "//host", "/\host" and "/<tab>/host" as
 * another site, so anything that could be one goes to the home page.
 */
export function safeNextPath(next: string | string[] | undefined): string {
  if (typeof next !== "string" || !next.startsWith("/")) return "/";
  if (looksLikeAnotherSite(next)) return "/";
  let url: URL;
  try {
    url = new URL(next, site);
  } catch {
    return "/";
  }
  const path = `${url.pathname}${url.search}${url.hash}`;
  // Dot segments can turn "/.//host" into "//host", which a browser reads as
  // another site.
  return url.origin === site && !path.startsWith("//") ? path : "/";
}
