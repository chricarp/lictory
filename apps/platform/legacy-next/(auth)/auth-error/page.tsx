import type { Metadata } from "next";
import Link from "next/link";

import { AuthHeading } from "@lictory/platform/components/auth/auth-layout";
import { Button } from "@lictory/ui/button";
import { StateIllustration } from "@lictory/ui/state-illustration";
import { oauthErrorMessage } from "@lictory/core/lib/oauth-errors";

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
