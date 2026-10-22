import { siteLink } from "@lictory/platform/lib/site";
import { AuthLink } from "@lictory/platform/components/auth/auth-layout";

export function AccountLegalNotice({ signIn = false }: { signIn?: boolean }) {
  return (
    <p className="mb-6 text-center text-xs leading-5 text-muted-foreground">
      {signIn
        ? "If continuing creates a new Lictory account, you agree to our "
        : "By creating a Lictory account, you agree to our "}
      <AuthLink href={siteLink("/terms-of-service")}>Terms of Service</AuthLink> and
      acknowledge our <AuthLink href={siteLink("/privacy")}>Privacy Notice</AuthLink>.{" "}
      Optional analytics is a separate choice in Privacy preferences.
    </p>
  );
}
