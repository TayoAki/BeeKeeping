import "@beekeeping/ui/styles.css";

import { parseTheme, themeCookie } from "@beekeeping/ui";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import type { ReactNode } from "react";

// Each page names itself, so the tab and a screen reader say which it is.
export const metadata: Metadata = {
  title: { default: "BeeKeeping", template: "%s · BeeKeeping" },
  description: "Double-entry bookkeeping for small businesses.",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  // The chosen theme is in a cookie, so the first paint is already right.
  // Without one, the styles follow the system's preference.
  const theme = parseTheme((await cookies()).get(themeCookie)?.value);
  return (
    <html lang="en" data-theme={theme}>
      <body>{children}</body>
    </html>
  );
}
