import type { Metadata } from "next";
import { VerificationStatus } from "~/components/auth/verification-status";

export const metadata: Metadata = { title: "Verify your email" };

export default async function VerifyEmailPage({
  searchParams,
}: PageProps<"/verify-email">) {
  const params = await searchParams;

  return (
    <VerificationStatus
      email={typeof params.email === "string" ? params.email : undefined}
      verified={params.verified === "1"}
      errorCode={typeof params.error === "string" ? params.error : undefined}
    />
  );
}
