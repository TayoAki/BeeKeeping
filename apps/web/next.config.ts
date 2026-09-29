import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  typedRoutes: true,
  // Sign-in and reset links carry tokens in the address. Keep them out of
  // the dev server's request log.
  logging: {
    incomingRequests: {
      ignore: [/\/api\/auth\//, /\/reset-password/, /\/confirm-email/],
    },
  },
  // next dev would write its own AGENTS.md and CLAUDE.md here. The ones at
  // the repo root already guide agents.
  agentRules: false,
  // Workspace packages ship TypeScript source, so Next.js compiles them.
  transpilePackages: [
    "@beekeeping/actions",
    "@beekeeping/db",
    "@beekeeping/services",
  ],
  // The reset and confirmation pages' addresses hold their tokens. No
  // request from the pages may carry one in Referer, and the header arrives
  // before any of them.
  headers: () =>
    Promise.resolve([
      {
        source: "/:page(reset-password|confirm-email)",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
    ]),
  experimental: {
    // forbidden() answers 403 when a role doesn't allow a page.
    authInterrupts: true,
  },
};

export default nextConfig;
