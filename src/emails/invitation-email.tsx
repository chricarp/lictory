import { Text } from "@react-email/components";
import {
  AuthEmailLayout,
  emailParagraph,
} from "./components/auth-email-layout";

export type InvitationEmailMessage = {
  to: string;
  inviterName: string;
  organizationName: string;
  existingUser: boolean;
  actionUrl: string;
  expiresAt: Date;
};

export function createInvitationEmail(message: InvitationEmailMessage) {
  const { inviterName, organizationName, existingUser, actionUrl } = message;
  const introduction = `${inviterName} invited you to join ${organizationName} on Lictory.`;
  const instructions = existingUser
    ? `Sign in with ${message.to} to review and accept your invitation.`
    : `Create a Lictory account with ${message.to}, verify your email, then accept your invitation. Your organization already has a workspace; you do not need to create one.`;
  const expiry = `This invitation expires on ${message.expiresAt.toUTCString()}.`;
  const actionLabel = existingUser
    ? "Review invitation"
    : "Create account and join";
  return {
    subject: `${inviterName} invited you to ${organizationName} on Lictory`,
    text: `${introduction}\n\n${existingUser ? "Your Lictory account is ready to join." : "Lictory helps product, engineering, and QA refine proposals, review specifications, and agree on work that is ready to build."}\n\n${instructions}\n\n${expiry}\n\n${actionLabel}: ${actionUrl}\n\nIf you were not expecting this invitation, you can ignore it. Joining requires your acceptance.`,
    react: (
      <AuthEmailLayout
        preview={introduction}
        heading={`Join ${organizationName}`}
        actionLabel={actionLabel}
        actionUrl={actionUrl}
        footerText="If you were not expecting this invitation, you can ignore it. Joining requires your acceptance."
      >
        <Text style={emailParagraph}>{introduction}</Text>
        {!existingUser && (
          <Text style={emailParagraph}>
            Lictory helps product, engineering, and QA refine proposals, review
            specifications, and agree on work that is ready to build.
          </Text>
        )}
        <Text style={emailParagraph}>{instructions}</Text>
        <Text style={emailParagraph}>{expiry}</Text>
      </AuthEmailLayout>
    ),
  };
}
