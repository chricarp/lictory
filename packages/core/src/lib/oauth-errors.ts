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
  // Instance policy (lib/instance-policy.ts).
  signup_invitation_required: {
    "sign-in":
      "New accounts on this installation need an invitation. Ask an administrator of your organization to invite you, then open the link in the invitation email.",
  },
  signup_closed: {
    "sign-in":
      "Accounts on this installation are created by its administrators. Ask your Lictory administrator for access.",
  },
  signup_domain_not_allowed: {
    "sign-in":
      "Accounts on this installation are limited to your company's email domains. Sign in with your work account.",
  },
  account_deactivated: {
    "sign-in":
      "Your Lictory account has been deactivated. Ask your Lictory administrator if you need access again.",
    connect:
      "Your Lictory account has been deactivated. Ask your Lictory administrator if you need access again.",
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
