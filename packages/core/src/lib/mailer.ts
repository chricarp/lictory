// Transport shared by auth and notification email. Resend when RESEND_API_KEY
// is set, otherwise SMTP (Mailpit in local development). Deliberately free of
// Next.js-only imports so background workers can send too.
import type { ReactElement } from "react";

import { render } from "@react-email/render";
import nodemailer from "nodemailer";
import { Resend } from "resend";

import { env, envInteger, type Environment } from "@lictory/core/lib/env";

export type OutgoingEmail = {
  to: string;
  subject: string;
  text: string;
  react: ReactElement;
  idempotencyKey: string;
};

export type MailSettings =
  | { transport: "resend"; apiKey: string; from: string }
  | {
      transport: "smtp";
      host: string;
      port: number;
      auth: { user: string; pass: string } | undefined;
      from: string;
    };

// Blank variables count as unset, so deployments that forward every variable
// still get the defaults.
export function mailSettings(source: Environment = process.env): MailSettings {
  const apiKey = env("RESEND_API_KEY", source);
  if (apiKey)
    return {
      transport: "resend",
      apiKey,
      from:
        env("RESEND_FROM_EMAIL", source) ??
        "Lictory <no-reply@email.lictory.com>",
    };
  const user = env("SMTP_USER", source);
  // Passwords are used verbatim; only a blank one counts as unset.
  const pass = env("SMTP_PASSWORD", source) && source.SMTP_PASSWORD;
  return {
    transport: "smtp",
    host: env("SMTP_HOST", source) ?? "localhost",
    port: envInteger("SMTP_PORT", source) ?? 1025,
    auth: user && pass ? { user, pass } : undefined,
    from: env("SMTP_FROM", source) ?? "Lictory <no-reply@lictory.local>",
  };
}

const settings = mailSettings();
const resend =
  settings.transport === "resend" ? new Resend(settings.apiKey) : null;
const smtpTransporter =
  settings.transport === "smtp"
    ? nodemailer.createTransport({
        host: settings.host,
        port: settings.port,
        secure: false,
        auth: settings.auth,
      })
    : null;

export async function sendEmail(email: OutgoingEmail) {
  if (resend) {
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
    return;
  }
  await smtpTransporter!.sendMail({
    from: settings.from,
    to: email.to,
    subject: email.subject,
    text: email.text,
    html: await render(email.react),
    messageId: `<${email.idempotencyKey}@lictory.local>`,
  });
}
