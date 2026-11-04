import { analyticsConfigured } from "@lictory/core/lib/analytics/client";
import { publicConfig } from "@lictory/platform/lib/public-config";
import { AuthLink } from "@lictory/platform/components/auth/auth-layout";

// The installation operator's own notices (LEGAL_TERMS_URL,
// LEGAL_PRIVACY_URL). Lictory publishes no terms on an operator's behalf:
// without them account creation shows no acceptance notice at all.
export function AccountLegalNotice({ signIn = false }: { signIn?: boolean }) {
  const { termsUrl, privacyUrl } = publicConfig.legal;
  if (!termsUrl && !privacyUrl) return null;
  const terms = termsUrl && (
    <AuthLink href={termsUrl}>Terms of Service</AuthLink>
  );
  const privacy = privacyUrl && (
    <AuthLink href={privacyUrl}>Privacy Notice</AuthLink>
  );
  return (
    <p className="mb-6 text-center text-xs leading-5 text-muted-foreground">
      {signIn
        ? "If continuing creates a new account, you "
        : "By creating an account, you "}
      {terms && <>agree to the {terms}</>}
      {terms && privacy && " and "}
      {privacy && <>acknowledge the {privacy}</>}.
      {privacy &&
        analyticsConfigured() &&
        " Optional analytics is a separate choice in Privacy preferences."}
    </p>
  );
}
