import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { AuthHeading } from "~/components/auth/auth-layout";
import { ForgotPasswordForm } from "~/components/auth/forgot-password-form";

export const metadata: Metadata = { title: "Reset your password" };

export default function ForgotPasswordPage() {
  return (
    <>
      <Link
        href="/sign-in"
        className="mb-7 inline-flex items-center gap-1.5 rounded-lg text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="size-4" />
        Back to sign in
      </Link>
      <AuthHeading
        title="Reset your password"
        description="Enter your account email and we’ll send you a secure reset link."
      />
      <ForgotPasswordForm />
    </>
  );
}
