import { siteLink } from "@lictory/platform/lib/site";
import { AuthLink } from "@lictory/platform/components/auth/auth-layout";

// The operator's terms and privacy notice live on its website. An
// installation without one has no notice to link to, so none is shown.
export function AccountLegalNotice({ signIn = false }: { signIn?: boolean }) {
  const terms = siteLink("/terms-of-service");
  const privacy = siteLink("/privacy");
  if (!terms || !privacy) return null;
  return (
    <p className="mb-6 text-center text-xs leading-5 text-muted-foreground">
      {signIn
        ? "If continuing creates a new Lictory account, you agree to our "
        : "By creating a Lictory account, you agree to our "}
      <AuthLink href={terms}>Terms of Service</AuthLink> and acknowledge our{" "}
      <AuthLink href={privacy}>Privacy Notice</AuthLink>. Optional analytics is
      a separate choice in Privacy preferences.
    </p>
  );
}
