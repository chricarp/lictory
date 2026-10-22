import { Text } from "@react-email/components";

import {
  AuthEmailLayout,
  emailParagraph,
} from "@lictory/core/emails/components/auth-email-layout";

export type ResetPasswordEmailProps = {
  name: string;
  resetUrl: string;
};

export function ResetPasswordEmail({
  name,
  resetUrl,
}: ResetPasswordEmailProps) {
  const greeting = name.trim() ? `Hi ${name.trim()},` : "Hi,";

  return (
    <AuthEmailLayout
      preview="Use this secure link to reset your Lictory password."
      heading="Reset your password"
      actionLabel="Reset password"
      actionUrl={resetUrl}
    >
      <Text style={emailParagraph}>{greeting}</Text>
      <Text style={emailParagraph}>
        Someone requested a password reset for your Lictory account. Use the
        secure link below to choose a new password. It expires in one hour.
      </Text>
    </AuthEmailLayout>
  );
}

ResetPasswordEmail.PreviewProps = {
  name: "Alex Morgan",
  resetUrl: "https://app.lictory.com/reset-password?token=preview",
} satisfies ResetPasswordEmailProps;

export default ResetPasswordEmail;
