import { Text } from "@react-email/components";
import {
  AuthEmailLayout,
  emailParagraph,
  type EmailBrand,
} from "@lictory/core/emails/components/auth-email-layout";

export type InvitationEmailMessage = {
  to: string;
  inviterName: string;
  organizationName: string;
  existingUser: boolean;
  actionUrl: string;
  expiresAt: Date;
  brand?: EmailBrand;
};

export function createInvitationEmail(message: InvitationEmailMessage) {
  const { inviterName, organizationName, existingUser, actionUrl } = message;
  const introduction = `${inviterName} invited you to join ${organizationName} on Lictory.`;
  const instructions = existingUser
    ? `Sign in with ${message.to} to accept.`
    : `Create a Lictory account with ${message.to}, verify your email, then accept.`;
  const expiry = `This invitation expires on ${message.expiresAt.toUTCString()}.`;
  const actionLabel = existingUser
    ? "Review invitation"
    : "Create account and join";
  return {
    subject: `${inviterName} invited you to ${organizationName} on Lictory`,
    text: `${introduction}\n\n${instructions}\n\n${expiry}\n\n${actionLabel}: ${actionUrl}\n\nIf you were not expecting this invitation, ignore it.`,
    react: (
      <AuthEmailLayout
        preview={introduction}
        heading={`Join ${organizationName}`}
        actionLabel={actionLabel}
        actionUrl={actionUrl}
        brand={message.brand}
        footerText="If you were not expecting this invitation, ignore it."
      >
        <Text style={emailParagraph}>{introduction}</Text>
        <Text style={emailParagraph}>{instructions}</Text>
        <Text style={emailParagraph}>{expiry}</Text>
      </AuthEmailLayout>
    ),
  };
}
