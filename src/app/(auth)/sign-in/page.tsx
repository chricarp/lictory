import type { Metadata } from "next";

import {
  AuthFooter,
  AuthHeading,
  AuthLink,
} from "~/components/auth/auth-layout";
import { SignInForm } from "~/components/auth/sign-in-form";
import { SocialButtons } from "~/components/auth/social-buttons";
import { authProviders } from "~/lib/auth";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({
  searchParams,
}: PageProps<"/sign-in">) {
  const params = await searchParams;
  const requestedCallback =
    typeof params.callbackUrl === "string" ? params.callbackUrl : "/app";
  const callbackURL = requestedCallback.startsWith("/")
    ? requestedCallback
    : "/app";

  return (
    <>
      <AuthHeading title="Sign in to Lictory" />
      <SocialButtons providers={authProviders} callbackURL={callbackURL} />
      <SignInForm callbackURL={callbackURL} />
      <AuthFooter>
        New to Lictory? <AuthLink href="/sign-up">Create an account</AuthLink>
      </AuthFooter>
    </>
  );
}
