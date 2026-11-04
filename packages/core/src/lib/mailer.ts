// Transport shared by auth and notification email: Resend when RESEND_API_KEY
// is set, otherwise any SMTP server (Mailpit in local development). Production
// never falls back to a local server: without a transport, email is disabled
// (startup warns, sending fails with the settings to add), and partial
// settings stop the service (see docs/operations/deployment.md#email).
// Deliberately free of Next.js-only imports so background workers can send too.
import type { ReactElement } from "react";

import { render } from "@react-email/render";
import nodemailer from "nodemailer";
import { Resend } from "resend";

import { platformUrl } from "@lictory/core/lib/auth-base-url";
import {
  env,
  envBoolean,
  envInteger,
  type Environment,
} from "@lictory/core/lib/env";

export type OutgoingEmail = {
  to: string;
  subject: string;
  text: string;
  react: ReactElement;
  idempotencyKey: string;
};

export type MailSettings =
  // Production without RESEND_API_KEY or SMTP_HOST: nothing is delivered.
  | { transport: "none"; reason: string }
  | { transport: "resend"; apiKey: string; from: string }
  | {
      transport: "smtp";
      host: string;
      port: number;
      // TLS from the first byte (SMTPS, port 465). Otherwise the connection
      // upgrades with STARTTLS when the server offers it.
      secure: boolean;
      // Refuse to send unless STARTTLS succeeds.
      requireTLS: boolean;
      auth: { user: string; pass: string } | undefined;
      from: string;
      // Message-IDs are <idempotency key@platform host>.
      messageIdDomain: string;
    };

export class MailConfigurationError extends Error {}

const missingTransport =
  "Email is not configured, so verification, invitation, password reset and notification email are not delivered; password sign-up cannot be completed (single sign-on still works). To send email, " +
  "set SMTP_HOST, SMTP_PORT and SMTP_FROM (plus SMTP_USER and SMTP_PASSWORD when the server requires authentication), " +
  "or RESEND_API_KEY and RESEND_FROM_EMAIL. See docs/operations/deployment.md#email.";

function sender(
  name: "SMTP_FROM" | "RESEND_FROM_EMAIL",
  source: Environment,
  developmentDefault: string,
) {
  const from = env(name, source);
  if (from) return from;
  if (source.NODE_ENV === "production")
    throw new MailConfigurationError(
      `${name} is required in production: set the sender of every Lictory email, for example ${name}="Lictory <no-reply@mail.example.com>", using a domain your mail provider is allowed to send for.`,
    );
  return developmentDefault;
}

// Blank variables count as unset. Throws MailConfigurationError when a
// production transport has no explicit sender.
export function mailSettings(source: Environment = process.env): MailSettings {
  const apiKey = env("RESEND_API_KEY", source);
  if (apiKey)
    return {
      transport: "resend",
      apiKey,
      from: sender(
        "RESEND_FROM_EMAIL",
        source,
        "Lictory <no-reply@email.lictory.com>",
      ),
    };
  const production = source.NODE_ENV === "production";
  const host = env("SMTP_HOST", source);
  if (!host && production)
    return { transport: "none", reason: missingTransport };
  // 587 (submission) for a configured server; Mailpit's 1025 in development.
  const port = envInteger("SMTP_PORT", source) ?? (production ? 587 : 1025);
  const user = env("SMTP_USER", source);
  // Passwords are used verbatim; only a blank one counts as unset.
  const pass = env("SMTP_PASSWORD", source) && source.SMTP_PASSWORD;
  return {
    transport: "smtp",
    host: host ?? "localhost",
    port,
    secure: envBoolean("SMTP_SECURE", source) ?? port === 465,
    requireTLS: envBoolean("SMTP_REQUIRE_TLS", source) ?? false,
    auth: user && pass ? { user, pass } : undefined,
    from: sender("SMTP_FROM", source, "Lictory <no-reply@lictory.local>"),
    messageIdDomain: new URL(platformUrl(source)).hostname,
  };
}

// For startup: validates the mail settings (throwing MailConfigurationError
// with an actionable message) and describes the transport without secrets.
export function mailTransportSummary(source: Environment = process.env) {
  const settings = mailSettings(source);
  if (settings.transport === "none") return { transport: "none" as const };
  return settings.transport === "resend"
    ? { transport: "resend" as const }
    : {
        transport: "smtp" as const,
        host: settings.host,
        port: settings.port,
        secure: settings.secure,
        requireTLS: settings.requireTLS,
        authenticated: Boolean(settings.auth),
      };
}

type Sender = (email: OutgoingEmail) => Promise<void>;

export function createSender(settings: MailSettings): Sender {
  if (settings.transport === "none")
    return () => Promise.reject(new MailConfigurationError(settings.reason));
  if (settings.transport === "resend") {
    const resend = new Resend(settings.apiKey);
    return async (email) => {
      const { error } = await resend.emails.send(
        {
          from: settings.from,
          to: [email.to],
          subject: email.subject,
          react: email.react,
          text: email.text,
        },
        { idempotencyKey: email.idempotencyKey },
      );
      if (error) throw new Error(`Resend rejected the email: ${error.message}`);
    };
  }
  const transporter = nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    requireTLS: settings.requireTLS,
    auth: settings.auth,
  });
  return async (email) => {
    await transporter.sendMail({
      from: settings.from,
      to: email.to,
      subject: email.subject,
      text: email.text,
      html: await render(email.react),
      messageId: `<${email.idempotencyKey}@${settings.messageIdDomain}>`,
    });
  };
}

let configured: Sender | undefined;
export async function sendEmail(email: OutgoingEmail) {
  configured ??= createSender(mailSettings());
  await configured(email);
}
