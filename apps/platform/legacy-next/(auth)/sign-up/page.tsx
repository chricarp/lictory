import {
  AuthFooter,
  AuthHeading,
  AuthLink,
} from "@lictory/platform/components/auth/auth-layout";
import { SignUpForm } from "@lictory/platform/components/auth/sign-up-form";
import { JsonLd } from "@lictory/marketing/components/json-ld";
import { AccountLegalNotice } from "@lictory/platform/components/auth/legal-notice";
import { SocialButtons } from "@lictory/platform/components/auth/social-buttons";
import { authProviders } from "@lictory/core/lib/auth";
import { safeAppPath } from "@lictory/core/lib/paths";
import { publicPageMetadata } from "@lictory/marketing/lib/public-metadata";
import { publicPageStructuredData } from "@lictory/marketing/lib/structured-data";

// The one indexable account page; the auth layout keeps the others out of search.
export const metadata = publicPageMetadata("/sign-up");

export default async function SignUpPage({
  searchParams,
}: PageProps<"/sign-up">) {
  const params = await searchParams;
  const callbackURL = safeAppPath(
    typeof params.callbackUrl === "string" ? params.callbackUrl : null,
  );
  return (
    <>
      <AuthHeading title="Create your account" />
      <AccountLegalNotice />
      <SocialButtons
        providers={authProviders}
        callbackURL={callbackURL}
        errorCallbackURL={`/sign-up?callbackUrl=${encodeURIComponent(callbackURL)}`}
        error={typeof params.error === "string" ? params.error : undefined}
      />
      <SignUpForm callbackURL={callbackURL} />
      <AuthFooter>
        Already have an account?{" "}
        <AuthLink
          href={`/sign-in?callbackUrl=${encodeURIComponent(callbackURL)}`}
        >
          Sign in
        </AuthLink>
      </AuthFooter>
      <JsonLd data={publicPageStructuredData("/sign-up")} />
    </>
  );
}
