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
      preview="Reset your Lictory password."
      heading="Reset your password"
      actionLabel="Reset password"
      actionUrl={resetUrl}
    >
      <Text style={emailParagraph}>{greeting}</Text>
      <Text style={emailParagraph}>
        Someone requested a password reset for your Lictory account. This link
        expires in one hour.
      </Text>
    </AuthEmailLayout>
  );
}

ResetPasswordEmail.PreviewProps = {
  name: "Alex Morgan",
  resetUrl: "https://lictory.example.com/reset-password?token=preview",
} satisfies ResetPasswordEmailProps;

export default ResetPasswordEmail;
