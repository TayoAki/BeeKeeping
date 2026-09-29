import { describe, expect, it } from "vitest";

import {
  existingAccount,
  invitation,
  magicLink,
  noAccount,
  resetPassword,
  useTwoFactorSignIn,
  verifyEmail,
} from "./emails.ts";

describe("auth emails", () => {
  it("puts the link in both the text and the HTML", () => {
    const url = "https://app.example.test/verify?token=abc&next=%2F";
    for (const email of [
      verifyEmail({ url }),
      magicLink({ url }),
      resetPassword({ url }),
    ]) {
      expect(email.text).toContain(url);
      expect(email.html).toContain(
        'href="https://app.example.test/verify?token=abc&amp;next=%2F"',
      );
    }
  });

  it("escapes names from the organization and the inviter", () => {
    const email = invitation({
      url: "https://app.example.test/invitations/1",
      organizationName: "<b>Honeycomb</b> & Co",
      inviterName: 'Avery "A" O\'Neil',
      role: "bookkeeper",
    });
    expect(email.subject).toBe("Join <b>Honeycomb</b> & Co on BeeKeeping");
    expect(email.html).toContain("&lt;b&gt;Honeycomb&lt;/b&gt; &amp; Co");
    expect(email.html).toContain("Avery &quot;A&quot; O&#39;Neil");
    expect(email.html).not.toContain("<b>Honeycomb</b>");
    expect(email.text).toContain("as a bookkeeper");
  });

  it("tells someone with two-factor on to sign in with their code", () => {
    const email = useTwoFactorSignIn({
      url: "https://app.example.test/sign-in",
    });
    expect(email.subject).toBe("Sign in to BeeKeeping with your code");
    expect(email.text).toContain("Sign in: https://app.example.test/sign-in");
    expect(email.text).toContain("authenticator app");
  });

  it("tells an existing account's owner how to get back in", () => {
    const email = existingAccount({ url: "https://app.example.test/sign-in" });
    expect(email.subject).toBe("You already have a BeeKeeping account");
    expect(email.text).toContain("Sign in: https://app.example.test/sign-in");
  });

  it("says how long a reset link lasts, and that two-factor stays on", () => {
    const email = resetPassword({ url: "https://app.example.test/reset" });
    expect(email.subject).toBe("Reset your BeeKeeping password");
    expect(email.text).toContain("30 minutes");
    expect(email.text).toContain("two-factor");
  });

  it("points an address with no account to sign-up", () => {
    const email = noAccount({ url: "https://app.example.test/sign-up" });
    expect(email.subject).toBe(
      "There's no BeeKeeping account for this address",
    );
    expect(email.text).toContain(
      "Create an account: https://app.example.test/sign-up",
    );
  });

  it("says an admin, not a admin", () => {
    const email = invitation({
      url: "https://app.example.test/invitations/1",
      organizationName: "Honeycomb Design Studio",
      inviterName: "Avery",
      role: "admin",
    });
    expect(email.text).toContain("as an admin");
  });
});
