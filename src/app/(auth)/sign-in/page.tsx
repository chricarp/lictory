import type { Metadata } from "next";
import Link from "next/link";

import { AuthHeading } from "~/components/auth/auth-layout";
import { SignInForm } from "~/components/auth/sign-in-form";
import { AuthDivider, SocialButtons } from "~/components/auth/social-buttons";
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
      <AuthHeading
        title="Welcome back"
        description={
          <>
            New to Lictory?{" "}
            <Link
              href="/sign-up"
              className="font-medium text-primary hover:underline"
            >
              Create an account
            </Link>
          </>
        }
      />
      <SocialButtons providers={authProviders} callbackURL={callbackURL} />
      <AuthDivider />
      <SignInForm callbackURL={callbackURL} />
    </>
  );
}
