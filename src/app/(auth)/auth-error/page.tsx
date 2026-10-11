import type { Metadata } from "next";
import Link from "next/link";

import { AuthHeading } from "~/components/auth/auth-layout";
import { Button } from "~/components/ui/button";
import { StateIllustration } from "~/components/ui/state-illustration";
import { oauthErrorMessage } from "~/lib/oauth-errors";

export const metadata: Metadata = { title: "Sign-in interrupted" };

export default async function AuthErrorPage({
  searchParams,
}: PageProps<"/auth-error">) {
  const params = await searchParams;
  const message =
    oauthErrorMessage(
      typeof params.error === "string" ? params.error : null,
      "sign-in",
    ) ?? "The authentication request could not be completed.";

  return (
    <>
      <StateIllustration kind="recovery" />
      <AuthHeading title="Sign-in interrupted" description={message} />
      <Link href="/sign-in" className="contents">
        <Button size="lg" className="w-full">
          Try again
        </Button>
      </Link>
    </>
  );
}
