import type { Metadata } from "next";
import { previewKind, socialMetadata } from "~/lib/social-preview";
import { safeAppPath } from "~/lib/paths";

import {
  AuthFooter,
  AuthHeading,
  AuthLink,
} from "~/components/auth/auth-layout";
import { SignInForm } from "~/components/auth/sign-in-form";
import { AccountLegalNotice } from "~/components/auth/legal-notice";
import { SocialButtons } from "~/components/auth/social-buttons";
import { authProviders } from "~/lib/auth";

export async function generateMetadata({
  searchParams,
}: PageProps<"/sign-in">): Promise<Metadata> {
  const params = await searchParams;
  const callback =
    typeof params.callbackUrl === "string" ? params.callbackUrl : "/app";
  return {
    title: "Sign in",
    ...socialMetadata(previewKind(safeAppPath(callback))),
  };
}

export default async function SignInPage({
  searchParams,
}: PageProps<"/sign-in">) {
  const params = await searchParams;
  const requestedCallback =
    typeof params.callbackUrl === "string" ? params.callbackUrl : "/app";
  const callbackURL = safeAppPath(requestedCallback);
  const here = `/sign-in?callbackUrl=${encodeURIComponent(callbackURL)}`;

  return (
    <>
      <AuthHeading title="Sign in to Lictory" />
      <AccountLegalNotice signIn />
      <SocialButtons
        providers={authProviders}
        callbackURL={callbackURL}
        errorCallbackURL={here}
        error={typeof params.error === "string" ? params.error : undefined}
      />
      <SignInForm callbackURL={callbackURL} />
      <AuthFooter>
        New to Lictory?{" "}
        <AuthLink
          href={`/sign-up?callbackUrl=${encodeURIComponent(callbackURL)}`}
        >
          Create an account
        </AuthLink>
      </AuthFooter>
    </>
  );
}
