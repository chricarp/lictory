import type { Metadata } from "next";
import { previewKind, socialMetadata } from "@lictory/marketing/lib/social-preview";
import { safeAppPath } from "@lictory/core/lib/paths";

import {
  AuthFooter,
  AuthHeading,
  AuthLink,
} from "@lictory/platform/components/auth/auth-layout";
import { SignInForm } from "@lictory/platform/components/auth/sign-in-form";
import { AccountLegalNotice } from "@lictory/platform/components/auth/legal-notice";
import { SocialButtons } from "@lictory/platform/components/auth/social-buttons";
import { authProviders } from "@lictory/core/lib/auth";

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
