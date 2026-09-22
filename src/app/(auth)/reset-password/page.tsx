import type { Metadata } from "next";
import { AuthHeading } from "~/components/auth/auth-layout";
import { ResetPasswordForm } from "~/components/auth/reset-password-form";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage({
  searchParams,
}: PageProps<"/reset-password">) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : undefined;

  return (
    <>
      <AuthHeading
        title="Choose a new password"
        description="Use at least 10 characters. A unique passphrase works best."
      />
      <ResetPasswordForm token={token} />
    </>
  );
}
