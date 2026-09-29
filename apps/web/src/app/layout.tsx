import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

// Each page names itself, so the tab and a screen reader say which it is.
export const metadata: Metadata = {
  title: { default: "BeeKeeping", template: "%s · BeeKeeping" },
  description: "Double-entry bookkeeping for small businesses.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
