import Link from "next/link";

import { AuthHeading } from "~/components/auth/auth-layout";
import { SignUpForm } from "~/components/auth/sign-up-form";
import { AuthDivider, SocialButtons } from "~/components/auth/social-buttons";
import { authProviders } from "~/lib/auth";

export default function SignUpPage() {
  return (
    <>
      <AuthHeading
        title="Create your account"
        description={
          <>
            Already have an account?{" "}
            <Link
              href="/sign-in"
              className="font-medium text-primary hover:underline"
            >
              Sign in
            </Link>
          </>
        }
      />
      <SocialButtons providers={authProviders} callbackURL="/app" />
      <AuthDivider />
      <SignUpForm />
    </>
  );
}
