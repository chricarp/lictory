import type { Metadata } from "next";

import {
  AuthFooter,
  AuthHeading,
  AuthLink,
} from "@lictory/platform/components/auth/auth-layout";
import { ForgotPasswordForm } from "@lictory/platform/components/auth/forgot-password-form";

export const metadata: Metadata = { title: "Reset your password" };

export default function ForgotPasswordPage() {
  return (
    <>
      <AuthHeading
        title="Reset your password"
        description="Enter your account email and we’ll send you a reset link."
      />
      <ForgotPasswordForm />
      <AuthFooter>
        <AuthLink href="/sign-in">Back to sign in</AuthLink>
      </AuthFooter>
    </>
  );
}
