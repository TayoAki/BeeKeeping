import { roleAtLeast } from "@beekeeping/actions";
import { parseTheme, themeCookie, ToastProvider } from "@beekeeping/ui";
import { cookies } from "next/headers";
import type { ReactNode } from "react";

import { AppShell } from "../../components/app-shell.tsx";
import {
  activeMembership,
  listMyOrganizations,
  requireSignedIn,
} from "../../server/session.ts";

/**
 * Every signed-in page sits in the app shell. Signing in and signing up sit
 * outside it. The pages read the same session and membership, once per
 * request.
 */
export default async function AppLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  await requireSignedIn();
  const [membership, organizations, cookieStore] = await Promise.all([
    activeMembership(),
    listMyOrganizations(),
    cookies(),
  ]);
  return (
    <ToastProvider>
      <AppShell
        organizations={organizations}
        activeId={membership?.organizationId}
        isAdmin={membership ? roleAtLeast(membership.role, "admin") : false}
        theme={parseTheme(cookieStore.get(themeCookie)?.value)}
      >
        {children}
      </AppShell>
    </ToastProvider>
  );
}
