import type { ReactNode } from "react";
import { platformUrl } from "@lictory/core/lib/auth-base-url";
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";

// How email sent on an organization's behalf looks: its wide logo, or its
// logomark beside its name, and its brand color for the button and links.
// Each part falls back to Lictory's on its own. Account email (verification,
// password reset) belongs to no organization and is never branded.
export type EmailBrand = {
  name: string;
  // An absolute, public image address with the size to display it at.
  logo: {
    kind: "mark" | "full";
    url: string;
    width: number;
    height: number;
  } | null;
  // The button's background and text; links use the background color.
  tone: { color: string; foreground: string } | null;
};

type AuthEmailLayoutProps = {
  preview: string;
  heading: string;
  actionLabel: string;
  actionUrl: string;
  children: ReactNode;
  footerText?: ReactNode;
  brand?: EmailBrand;
};

export const defaultEmailLinkColor = "#2563eb";
export const emailLinkColor = (brand?: EmailBrand) =>
  brand?.tone?.color ?? defaultEmailLinkColor;

export function AuthEmailLayout({
  preview,
  heading,
  actionLabel,
  actionUrl,
  children,
  footerText = "If you did not request this, you can safely ignore this email. No changes will be made to your account.",
  brand,
}: AuthEmailLayoutProps) {
  const linkColor = emailLinkColor(brand);
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={brandRow}>
            {brand?.logo ? (
              <table role="presentation" cellPadding={0} cellSpacing={0}>
                <tbody>
                  <tr>
                    <td style={{ verticalAlign: "middle" }}>
                      <Img
                        src={brand.logo.url}
                        // A wide logo already spells the name.
                        alt={brand.logo.kind === "full" ? brand.name : ""}
                        width={brand.logo.width}
                        height={brand.logo.height}
                        style={{ display: "block" }}
                      />
                    </td>
                    {brand.logo.kind === "mark" && (
                      <td style={brandName}>{brand.name}</td>
                    )}
                  </tr>
                </tbody>
              </table>
            ) : (
              <Img
                src={new URL(
                  "/brand/lictory-logo.png",
                  platformUrl(),
                ).toString()}
                alt="Lictory"
                width="137"
                height="34"
                style={{ display: "block" }}
              />
            )}
          </Section>

          <Heading as="h1" style={headingStyle}>
            {heading}
          </Heading>
          {children}

          <Section style={buttonRow}>
            <Button
              href={actionUrl}
              style={
                brand?.tone
                  ? {
                      ...button,
                      backgroundColor: brand.tone.color,
                      color: brand.tone.foreground,
                    }
                  : button
              }
            >
              {actionLabel}
            </Button>
          </Section>

          <Text style={fallbackText}>
            If the button does not work, copy and paste this link into your
            browser:
          </Text>
          <Link href={actionUrl} style={{ ...fallbackLink, color: linkColor }}>
            {actionUrl}
          </Link>

          <Hr style={divider} />
          <Text style={footer}>{footerText}</Text>
        </Container>
      </Body>
    </Html>
  );
}

export const emailParagraph = {
  color: "#52525b",
  fontSize: "15px",
  lineHeight: "24px",
  margin: "0 0 12px",
};

const body = {
  backgroundColor: "#f4f4f5",
  color: "#18181b",
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif",
  margin: "0",
  padding: "40px 12px",
};

const container = {
  backgroundColor: "#ffffff",
  border: "1px solid #e4e4e7",
  borderRadius: "16px",
  boxShadow: "0 8px 24px rgba(0, 0, 0, 0.06)",
  margin: "0 auto",
  maxWidth: "520px",
  padding: "32px",
};

const brandRow = { height: "34px", marginBottom: "28px" };

const brandName = {
  color: "#18181b",
  fontSize: "17px",
  fontWeight: "600",
  letterSpacing: "-0.2px",
  paddingLeft: "10px",
  verticalAlign: "middle" as const,
};

const headingStyle = {
  color: "#18181b",
  fontSize: "26px",
  fontWeight: "700",
  letterSpacing: "-0.6px",
  lineHeight: "32px",
  margin: "0 0 14px",
};

const buttonRow = { margin: "26px 0" };

const button = {
  backgroundColor: defaultEmailLinkColor,
  borderRadius: "10px",
  color: "#ffffff",
  fontSize: "14px",
  fontWeight: "600",
  lineHeight: "20px",
  padding: "12px 18px",
  textDecoration: "none",
};

const fallbackText = {
  color: "#71717a",
  fontSize: "12px",
  lineHeight: "18px",
  margin: "0 0 4px",
};

const fallbackLink = {
  fontSize: "12px",
  lineHeight: "18px",
  overflowWrap: "anywhere" as const,
};

const divider = { borderColor: "#e4e4e7", margin: "28px 0 20px" };

const footer = {
  color: "#71717a",
  fontSize: "12px",
  lineHeight: "18px",
  margin: "0",
};
