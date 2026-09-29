"use client";

import { accessControl, organizationRoles } from "@beekeeping/actions/access";
import {
  magicLinkClient,
  organizationClient,
  twoFactorClient,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/** The browser side of Better Auth. It calls /api/auth on this site. */
export const authClient = createAuthClient({
  plugins: [
    organizationClient({ ac: accessControl, roles: organizationRoles }),
    twoFactorClient({
      // The code page keeps the "next" path, so someone following an
      // invitation lands on it once the code is in.
      onTwoFactorRedirect() {
        const next = new URLSearchParams(window.location.search).get("next");
        const query = next
          ? `?${new URLSearchParams({ next }).toString()}`
          : "";
        window.location.assign(`/sign-in/two-factor${query}`);
      },
    }),
    magicLinkClient(),
  ],
});
