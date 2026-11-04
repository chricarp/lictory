// Transport shared by auth and notification email. Resend when RESEND_API_KEY
// is set, otherwise SMTP (Mailpit in local development). Deliberately free of
// Next.js-only imports so background workers can send too.
import type { ReactElement } from "react";

import { render } from "@react-email/render";
import nodemailer from "nodemailer";
import { Resend } from "resend";

export type OutgoingEmail = {
  to: string;
  subject: string;
  text: string;
  react: ReactElement;
  idempotencyKey: string;
};

const resendApiKey = process.env.RESEND_API_KEY?.trim();
const resend = resendApiKey ? new Resend(resendApiKey) : null;
const resendFromEmail =
  process.env.RESEND_FROM_EMAIL?.trim() ??
  "Lictory <no-reply@email.lictory.com>";

// Whether the operator configured a way to send email (without SMTP_HOST the
// transport falls back to a local development server).
export const emailConfigured = () =>
  resend !== null || Boolean(process.env.SMTP_HOST?.trim());

const smtpTransporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST ?? "localhost",
  port: Number(process.env.SMTP_PORT ?? 1025),
  secure: false,
  auth:
    process.env.SMTP_USER && process.env.SMTP_PASSWORD
      ? {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASSWORD,
        }
      : undefined,
});

export async function sendEmail(email: OutgoingEmail) {
  if (resend) {
    const { error } = await resend.emails.send(
      {
        from: resendFromEmail,
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
  await smtpTransporter.sendMail({
    from: process.env.SMTP_FROM ?? "Lictory <no-reply@lictory.local>",
    to: email.to,
    subject: email.subject,
    text: email.text,
    html: await render(email.react),
    messageId: `<${email.idempotencyKey}@lictory.local>`,
  });
}
