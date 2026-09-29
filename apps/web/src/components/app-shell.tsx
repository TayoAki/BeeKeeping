"use client";

import {
  chooseTheme,
  CommandPalette,
  ThemeButton,
  useToast,
  type Command,
  type Theme,
} from "@beekeeping/ui";
import type { Route } from "next";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { openOrganization, signOutHere } from "../lib/session-changes.ts";
import { useRequest } from "../lib/use-request.ts";

type Organization = { readonly id: string; readonly name: string };

type Place = { readonly href: Route; readonly label: string };

/** Whether an event is Ctrl+K, or Command+K on a Mac. */
function isPaletteShortcut(event: KeyboardEvent): boolean {
  // Autofill can send a keydown with no key. On a layout without Latin
  // letters, Ctrl+K reports that layout's letter, so the key's place on
  // the keyboard decides.
  const key = typeof event.key === "string" ? event.key.toLowerCase() : "";
  const isK = key === "k" || (!/^[a-z]$/.test(key) && event.code === "KeyK");
  return (
    isK && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey
  );
}

/**
 * The list of the person's organizations, behind a button that names the
 * one they're in. Escape closes it and puts focus back on that button.
 */
function OrganizationSwitcher({
  organizations,
  activeId,
  onSwitch,
}: {
  organizations: readonly Organization[];
  activeId: string | undefined;
  onSwitch: (organization: Organization) => void;
}) {
  const details = useRef<HTMLDetailsElement>(null);
  const summary = useRef<HTMLElement>(null);
  const active = organizations.find(({ id }) => id === activeId);

  function close() {
    if (details.current) details.current.open = false;
    summary.current?.focus();
  }

  // Escape closes the list and puts focus back on its button. Focus moving
  // anywhere else, by Tab or a click, closes it too.
  useEffect(() => {
    const element = details.current;
    if (!element) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !element.open) return;
      event.preventDefault();
      element.open = false;
      summary.current?.focus();
    };
    const onFocusOut = (event: FocusEvent) => {
      if (!element.contains(event.relatedTarget as Node | null)) {
        element.open = false;
      }
    };
    element.addEventListener("keydown", onKeyDown);
    element.addEventListener("focusout", onFocusOut);
    return () => {
      element.removeEventListener("keydown", onKeyDown);
      element.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  return (
    <details ref={details} className="switcher">
      <summary ref={summary}>
        <span className="visually-hidden">Organization: </span>
        {active?.name ?? "Choose an organization"}
      </summary>
      <ul aria-label="Your organizations">
        {organizations.map((organization) => (
          <li key={organization.id}>
            {organization.id === activeId ? (
              <span className="switcher-current" aria-current="true">
                {organization.name}
              </span>
            ) : (
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  close();
                  onSwitch(organization);
                }}
              >
                {organization.name}
              </button>
            )}
          </li>
        ))}
        <li>
          <Link href="/organizations/new" onClick={close}>
            New organization
          </Link>
        </li>
      </ul>
    </details>
  );
}

/**
 * The shell around every signed-in page: a skip link, the top bar with the
 * organization switcher, the command palette, the theme and signing out,
 * and the main navigation, which marks the page that's open. Ctrl+K opens
 * the palette from anywhere.
 */
export function AppShell({
  organizations,
  activeId,
  canManageMembers,
  theme,
  children,
}: {
  organizations: readonly Organization[];
  activeId: string | undefined;
  canManageMembers: boolean;
  theme: Theme | undefined;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const closePalette = useCallback(() => setPaletteOpen(false), []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!isPaletteShortcut(event)) return;
      event.preventDefault();
      setPaletteOpen(true);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const places = useMemo<Place[]>(
    () => [
      { href: "/", label: "Home" },
      ...(canManageMembers
        ? [{ href: "/settings/members" as Route, label: "Members" }]
        : []),
      { href: "/settings/account", label: "Your account" },
    ],
    [canManageMembers],
  );

  const switchTo = useCallback(
    async (organization: Organization) => {
      const failure = await openOrganization(organization.id);
      if (failure) {
        toast(failure, "error");
        return;
      }
      toast(`Switched to ${organization.name}.`, "success");
      router.push("/");
      router.refresh();
    },
    [router, toast],
  );

  // The top bar's button and the palette's command share one request, so
  // a second click while it runs does nothing.
  const { pending: signingOut, run: runSignOut } = useRequest();
  const signOut = useCallback(
    () =>
      void runSignOut(async () => {
        const failure = await signOutHere(router);
        if (failure) toast(failure, "error");
        return undefined;
      }),
    [router, toast, runSignOut],
  );

  const commands = useMemo<Command[]>(
    () => [
      ...places.map((place) => ({
        id: `go:${place.href}`,
        label: place.label,
        group: "Go to",
        run: () => router.push(place.href),
      })),
      ...organizations
        .filter(({ id }) => id !== activeId)
        .map((organization) => ({
          id: `switch:${organization.id}`,
          label: organization.name,
          group: "Switch organization",
          keywords: "organization",
          run: () => void switchTo(organization),
        })),
      {
        id: "organization:new",
        label: "New organization",
        group: "Organization",
        keywords: "create business",
        run: () => router.push("/organizations/new"),
      },
      {
        id: "theme:dark",
        label: "Dark theme",
        group: "Theme",
        run: () => chooseTheme("dark"),
      },
      {
        id: "theme:light",
        label: "Light theme",
        group: "Theme",
        run: () => chooseTheme("light"),
      },
      {
        id: "theme:system",
        label: "Match the system theme",
        group: "Theme",
        keywords: "automatic device",
        run: () => chooseTheme("system"),
      },
      {
        id: "account:sign-out",
        label: "Sign out",
        group: "Account",
        keywords: "log out",
        run: signOut,
      },
    ],
    [places, organizations, activeId, router, switchTo, signOut],
  );

  return (
    <>
      <a
        className="skip-link"
        href="#main"
        onClick={(event) => {
          // Following #main would add a history entry that the router
          // can't restore, and Back would then show the wrong page. Once
          // the page runs, the link moves focus without one.
          event.preventDefault();
          document.getElementById("main")?.focus();
        }}
      >
        Skip to content
      </a>
      <header className="topbar">
        <Link href="/" className="brand">
          BeeKeeping
        </Link>
        {organizations.length > 0 ? (
          <OrganizationSwitcher
            organizations={organizations}
            activeId={activeId}
            onSwitch={(organization) => void switchTo(organization)}
          />
        ) : null}
        <div className="topbar-end">
          <button
            type="button"
            className="secondary"
            aria-keyshortcuts="Control+K Meta+K"
            onClick={() => setPaletteOpen(true)}
          >
            Commands <kbd>Ctrl K</kbd>
          </button>
          <ThemeButton chosen={theme} />
          <button
            type="button"
            className="secondary"
            aria-disabled={signingOut}
            onClick={signOut}
          >
            Sign out
          </button>
        </div>
      </header>
      <nav className="mainnav" aria-label="Main">
        <ul>
          {places.map((place) => (
            <li key={place.href}>
              <Link
                href={place.href}
                aria-current={pathname === place.href ? "page" : undefined}
              >
                {place.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <main id="main" tabIndex={-1}>
        {children}
      </main>
      <CommandPalette
        open={paletteOpen}
        onClose={closePalette}
        commands={commands}
      />
    </>
  );
}
