import type { Metadata } from "next";
import Link from "next/link";

import { AuthHeading } from "~/components/auth/auth-layout";
import { Button } from "~/components/ui/button";

export const metadata: Metadata = { title: "Sign-in interrupted" };

export default async function AuthErrorPage({
  searchParams,
}: PageProps<"/auth-error">) {
  const params = await searchParams;
  const message =
    typeof params.error === "string"
      ? params.error.replaceAll("_", " ")
      : "The authentication request could not be completed.";

  return (
    <>
      <AuthHeading
        title="Sign-in interrupted"
        description={<span className="capitalize">{message}</span>}
      />
      <Link href="/sign-in" className="contents">
        <Button size="lg" className="w-full">
          Try again
        </Button>
      </Link>
    </>
  );
}
