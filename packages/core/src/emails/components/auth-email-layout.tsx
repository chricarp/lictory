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

type AuthEmailLayoutProps = {
  preview: string;
  heading: string;
  actionLabel: string;
  actionUrl: string;
  children: ReactNode;
  footerText?: ReactNode;
};

export function AuthEmailLayout({
  preview,
  heading,
  actionLabel,
  actionUrl,
  children,
  footerText = "If you did not request this, you can safely ignore this email. No changes will be made to your account.",
}: AuthEmailLayoutProps) {
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={brandRow}>
            <Img
              src={new URL("/brand/lictory-logo.png", platformUrl()).toString()}
              alt="Lictory"
              width="137"
              height="34"
              style={{ display: "block" }}
            />
          </Section>

          <Heading as="h1" style={headingStyle}>
            {heading}
          </Heading>
          {children}

          <Section style={buttonRow}>
            <Button href={actionUrl} style={button}>
              {actionLabel}
            </Button>
          </Section>

          <Text style={fallbackText}>
            If the button does not work, copy and paste this link into your
            browser:
          </Text>
          <Link href={actionUrl} style={fallbackLink}>
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
  backgroundColor: "#2563eb",
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
  color: "#2563eb",
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
