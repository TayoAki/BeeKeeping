import type { Role } from "../access/roles.ts";

/** One email's words. The web app sends it through the email service. */
export type EmailContent = {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
};

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function render(
  subject: string,
  paragraphs: string[],
  link: { url: string; label: string },
  closing: string,
): EmailContent {
  const text = [...paragraphs, `${link.label}: ${link.url}`, closing].join(
    "\n\n",
  );
  const html = [
    ...paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`),
    `<p><a href="${escapeHtml(link.url)}">${escapeHtml(link.label)}</a></p>`,
    `<p>${escapeHtml(closing)}</p>`,
  ].join("\n");
  return { subject, text, html };
}

export function verifyEmail({ url }: { url: string }): EmailContent {
  return render(
    "Confirm your email for BeeKeeping",
    [
      "Confirm this address to finish setting up your BeeKeeping account. The link asks for your BeeKeeping password, the new one if you reset it.",
    ],
    { url, label: "Confirm your email" },
    "If you didn't sign up, you can ignore this email. Without the password, the link confirms nothing.",
  );
}

export function magicLink({ url }: { url: string }): EmailContent {
  return render(
    "Your BeeKeeping sign-in link",
    ["Use this link to sign in to BeeKeeping. It works once, for 10 minutes."],
    { url, label: "Sign in" },
    "If you didn't ask for it, you can ignore this email.",
  );
}

/**
 * Sent when someone signs up with an address that already has an account.
 * Signing in with the right password sends a new confirmation link to an
 * address that isn't confirmed yet.
 */
export function existingAccount({ url }: { url: string }): EmailContent {
  return render(
    "You already have a BeeKeeping account",
    [
      "Someone tried to create a BeeKeeping account with this address, which already has one. If it was you, sign in instead. If you never confirmed the address, signing in with your password sends a new confirmation link. If you don't know the password, choose a new one with Forgot your password on the sign-in page.",
    ],
    { url, label: "Sign in" },
    "If it wasn't you, you can ignore this email. Your account hasn't changed.",
  );
}

/**
 * Sent when someone asks for a sign-in link or a password reset for an
 * address with no account, so every address gets the same answer.
 */
export function noAccount({ url }: { url: string }): EmailContent {
  return render(
    "There's no BeeKeeping account for this address",
    [
      "Someone asked BeeKeeping to email this address a way to sign in, but no account uses it. If it was you, you may have signed up with another address, or you can create an account.",
    ],
    { url, label: "Create an account" },
    "If it wasn't you, you can ignore this email.",
  );
}

export function resetPassword({ url }: { url: string }): EmailContent {
  return render(
    "Reset your BeeKeeping password",
    [
      "Use this link to choose a new password. It works once, for 30 minutes. Choosing one signs you out everywhere, and two-factor sign-in, if you have it on, still asks for your code.",
    ],
    { url, label: "Choose a new password" },
    "If you didn't ask for it, you can ignore this email. Your password hasn't changed.",
  );
}

/** Sent instead of a sign-in link when the account has two-factor on. */
export function useTwoFactorSignIn({ url }: { url: string }): EmailContent {
  return render(
    "Sign in to BeeKeeping with your code",
    [
      "You asked for a sign-in link. Your account has two-factor sign-in on, so it doesn't take links by email. Sign in with your password and the code from your authenticator app.",
    ],
    { url, label: "Sign in" },
    "If you didn't ask for a link, you can ignore this email. It can't sign anyone in.",
  );
}

export function invitation({
  url,
  organizationName,
  inviterName,
  role,
}: {
  url: string;
  organizationName: string;
  inviterName: string;
  role: Role;
}): EmailContent {
  return render(
    `Join ${organizationName} on BeeKeeping`,
    [
      `${inviterName} invited you to keep the books for ${organizationName} on BeeKeeping, as ${role === "admin" ? "an" : "a"} ${role}.`,
    ],
    { url, label: "Accept the invitation" },
    "The invitation works for 7 days. If you weren't expecting it, you can ignore this email.",
  );
}
