// Better Auth reports OAuth failures as a `?error=<code>` redirect. These
// messages explain what happened and what to do next, separately for signing
// in and for connecting a provider from account settings.

type Situation = "sign-in" | "connect";

const messages: Record<string, Partial<Record<Situation, string>>> = {
  access_denied: {
    "sign-in": "Sign-in was cancelled. Choose an account to continue.",
    connect: "Connecting was cancelled. Nothing changed on your account.",
  },
  account_not_linked: {
    "sign-in":
      "A Lictory account with this email already exists and can't be connected automatically. Sign in with your password (we'll resend the verification link if needed) or a connected provider, then connect this provider from Account settings.",
  },
  email_does_not_match: {
    connect:
      "That account uses a different email address. Choose the account that matches your Lictory email, or change your Lictory email first.",
  },
  account_already_linked_to_different_user: {
    connect:
      "That account is already connected to another Lictory account. Disconnect it there first, or sign in with it instead.",
  },
  email_not_found: {
    "sign-in":
      "The provider didn't share an email address, which Lictory needs to identify you.",
    connect:
      "The provider didn't share an email address, so it can't be connected.",
  },
  email_not_verified: {
    "sign-in":
      "Verify your email address first. We sent you a new verification link.",
  },
  signup_disabled: {
    "sign-in": "New accounts can't be created with this provider.",
  },
};

const fallback: Record<Situation, string> = {
  "sign-in":
    "We couldn't complete sign-in with that provider. Try again, or use your email and password.",
  connect: "We couldn't connect that account. Try again.",
};

export function oauthErrorMessage(
  code: string | null | undefined,
  situation: Situation,
): string | null {
  if (!code) return null;
  return messages[code]?.[situation] ?? fallback[situation];
}
