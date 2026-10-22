import { Text } from "@react-email/components";

import {
  AuthEmailLayout,
  emailParagraph,
} from "@lictory/core/emails/components/auth-email-layout";

export type VerifyEmailProps = {
  name: string;
  verificationUrl: string;
};

export function VerifyEmail({ name, verificationUrl }: VerifyEmailProps) {
  const greeting = name.trim() ? `Hi ${name.trim()},` : "Hi,";

  return (
    <AuthEmailLayout
      preview="Verify your email address to finish setting up Lictory."
      heading="Verify your email"
      actionLabel="Verify email"
      actionUrl={verificationUrl}
    >
      <Text style={emailParagraph}>{greeting}</Text>
      <Text style={emailParagraph}>
        Confirm this email address to finish securing your Lictory account. This
        link expires in one hour.
      </Text>
    </AuthEmailLayout>
  );
}

VerifyEmail.PreviewProps = {
  name: "Alex Morgan",
  verificationUrl: "https://app.lictory.com/verify-email?token=preview",
} satisfies VerifyEmailProps;

export default VerifyEmail;
