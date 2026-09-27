import type { Metadata } from "next";

import {
  AuthFooter,
  AuthHeading,
  AuthLink,
} from "~/components/auth/auth-layout";
import { SignUpForm } from "~/components/auth/sign-up-form";
import { SocialButtons } from "~/components/auth/social-buttons";
import { authProviders } from "~/lib/auth";

export const metadata: Metadata = { title: "Create your account" };

export default function SignUpPage() {
  return (
    <>
      <AuthHeading title="Create your account" />
      <SocialButtons providers={authProviders} callbackURL="/app" />
      <SignUpForm />
      <AuthFooter>
        Already have an account? <AuthLink href="/sign-in">Sign in</AuthLink>
      </AuthFooter>
    </>
  );
}
