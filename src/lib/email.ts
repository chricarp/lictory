import "server-only";

import { createHash } from "node:crypto";

import { createAuthEmail, type AuthEmailMessage } from "~/emails/auth-email";
import { sendEmail } from "~/lib/mailer";

export async function sendAuthEmail(message: AuthEmailMessage) {
  const email = createAuthEmail(message);
  await sendEmail({
    to: message.to,
    subject: email.subject,
    text: email.text,
    react: email.react,
    idempotencyKey: createIdempotencyKey(message),
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
