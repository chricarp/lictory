import { Link, Text } from "@react-email/components";

import {
  AuthEmailLayout,
  emailLinkColor,
  emailParagraph,
  type EmailBrand,
} from "@lictory/core/emails/components/auth-email-layout";

export type NotificationEmailProps = {
  organizationName: string;
  headline: string;
  body: string | null;
  title: string | null;
  actionUrl: string;
  preferencesUrl: string;
  brand?: EmailBrand;
};

export function NotificationEmail({
  organizationName,
  headline,
  body,
  title,
  actionUrl,
  preferencesUrl,
  brand,
}: NotificationEmailProps) {
  return (
    <AuthEmailLayout
      preview={headline}
      heading={headline}
      actionLabel="Open in Lictory"
      actionUrl={actionUrl}
      brand={brand}
      footerText={
        <>
          You receive this because of your notification settings in{" "}
          {organizationName}.{" "}
          <Link href={preferencesUrl} style={{ color: emailLinkColor(brand) }}>
            Change what you are emailed about
          </Link>
          .
        </>
      }
    >
      {title && (
        <Text style={{ ...emailParagraph, color: "#18181b", fontWeight: 600 }}>
          {title}
        </Text>
      )}
      {body && <Text style={emailParagraph}>{body}</Text>}
    </AuthEmailLayout>
  );
}

NotificationEmail.PreviewProps = {
  organizationName: "Acme",
  headline: "Ada Lovelace requested Engineering review of PAY-142",
  body: "Revision 3 · required",
  title: "Retry failed card payments",
  actionUrl: "https://lictory.example.com/acme/items/PAY-142",
  preferencesUrl: "https://lictory.example.com/acme/inbox/settings",
} satisfies NotificationEmailProps;

export default NotificationEmail;
