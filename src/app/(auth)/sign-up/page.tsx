import type { Metadata } from "next";

import {
  AuthFooter,
  AuthHeading,
  AuthLink,
} from "~/components/auth/auth-layout";
import { SignUpForm } from "~/components/auth/sign-up-form";
import { AccountLegalNotice } from "~/components/auth/legal-notice";
import { SocialButtons } from "~/components/auth/social-buttons";
import { authProviders } from "~/lib/auth";
import { safeAppPath } from "~/lib/paths";

export const metadata: Metadata = {
  title: "Create your account",
  description:
    "Start refining specifications with your team in Lictory for free.",
  robots: { index: true, follow: true },
  alternates: { canonical: "/sign-up" },
};

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
    </>
  );
}
