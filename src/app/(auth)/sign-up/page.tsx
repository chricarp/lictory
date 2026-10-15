import {
  AuthFooter,
  AuthHeading,
  AuthLink,
} from "~/components/auth/auth-layout";
import { SignUpForm } from "~/components/auth/sign-up-form";
import { JsonLd } from "~/components/json-ld";
import { AccountLegalNotice } from "~/components/auth/legal-notice";
import { SocialButtons } from "~/components/auth/social-buttons";
import { authProviders } from "~/lib/auth";
import { safeAppPath } from "~/lib/paths";
import { publicPageMetadata } from "~/lib/public-metadata";
import { publicPageStructuredData } from "~/lib/structured-data";

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
