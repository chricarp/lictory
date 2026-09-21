import { VerificationStatus } from "~/components/auth/verification-status";

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
