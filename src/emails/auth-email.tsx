import type { ReactElement } from "react";

import { ResetPasswordEmail } from "~/emails/reset-password";
import { VerifyEmail } from "~/emails/verify-email";

export type AuthEmailMessage =
  | {
      type: "verification";
      to: string;
      name: string;
      actionUrl: string;
    }
  | {
      type: "password-reset";
      to: string;
      name: string;
      actionUrl: string;
    };

type RenderedAuthEmail = {
  subject: string;
  text: string;
  react: ReactElement;
};

export function createAuthEmail(message: AuthEmailMessage): RenderedAuthEmail {
  if (message.type === "verification") {
    return {
      subject: "Verify your Lictory email",
      text: `Hi ${message.name},\n\nConfirm this email address to finish securing your Lictory account. This link expires in one hour.\n\nVerify email: ${message.actionUrl}\n\nIf you did not request this, you can safely ignore this email.`,
      react: (
        <VerifyEmail name={message.name} verificationUrl={message.actionUrl} />
      ),
    };
  }

  return {
    subject: "Reset your Lictory password",
    text: `Hi ${message.name},\n\nSomeone requested a password reset for your Lictory account. This link expires in one hour.\n\nReset password: ${message.actionUrl}\n\nIf you did not request this, you can safely ignore this email.`,
    react: (
      <ResetPasswordEmail name={message.name} resetUrl={message.actionUrl} />
    ),
  };
}
