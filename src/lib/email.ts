import "server-only";

import { createHash } from "node:crypto";

import { render } from "@react-email/render";
import nodemailer from "nodemailer";
import { Resend } from "resend";

import { createAuthEmail, type AuthEmailMessage } from "~/emails/auth-email";

const resendApiKey = process.env.RESEND_API_KEY?.trim();
const resend = resendApiKey ? new Resend(resendApiKey) : null;
const resendFromEmail =
  process.env.RESEND_FROM_EMAIL?.trim() ??
  "Lictory <no-reply@email.lictory.com>";

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

export async function sendAuthEmail(message: AuthEmailMessage) {
  const email = createAuthEmail(message);

  if (resend) {
    const { error } = await resend.emails.send(
      {
        from: resendFromEmail,
        to: [message.to],
        subject: email.subject,
        react: email.react,
        text: email.text,
      },
      { idempotencyKey: createIdempotencyKey(message) },
    );

    if (error) {
      throw new Error(
        `Resend rejected the authentication email: ${error.message}`,
      );
    }

    return;
  }

  await smtpTransporter.sendMail({
    from: process.env.SMTP_FROM ?? "Lictory <no-reply@lictory.local>",
    to: message.to,
    subject: email.subject,
    text: email.text,
    html: await render(email.react),
  });
}

export function deliverAuthEmail(message: AuthEmailMessage) {
  void sendAuthEmail(message).catch((error: unknown) => {
    console.error("Unable to send authentication email", error);
  });
}

function createIdempotencyKey(message: AuthEmailMessage) {
  const digest = createHash("sha256")
    .update(`${message.type}:${message.to}:${message.actionUrl}`)
    .digest("hex");

  return `lictory-auth-${digest}`;
}
