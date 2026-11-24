import { createHmac, timingSafeEqual } from "node:crypto";

// Slack request signing (https://api.slack.com/authentication/verifying-requests-from-slack):
// `X-Slack-Signature` is `v0=` and the hex HMAC-SHA256 of
// `v0:{X-Slack-Request-Timestamp}:{raw body}` keyed by the app's signing
// secret. A request older (or newer) than five minutes is refused, so a
// captured request cannot be replayed later; replays inside the window are
// stopped by storing each event id once (inbound.ts).

export const SLACK_REPLAY_WINDOW_SECONDS = 5 * 60;

export type SignatureCheck =
  { ok: true } | { ok: false; reason: "missing" | "stale" | "mismatch" };

export function slackSignature(
  signingSecret: string,
  timestamp: string,
  body: string,
): string {
  return `v0=${createHmac("sha256", signingSecret)
    .update(`v0:${timestamp}:${body}`)
    .digest("hex")}`;
}

export function verifySlackSignature(
  signingSecret: string,
  headers: { get(name: string): string | null },
  body: string,
  now: Date = new Date(),
): SignatureCheck {
  const timestamp = headers.get("x-slack-request-timestamp")?.trim() ?? "";
  const signature = headers.get("x-slack-signature")?.trim() ?? "";
  if (!/^\d{1,12}$/.test(timestamp) || !signature.startsWith("v0="))
    return { ok: false, reason: "missing" };
  const age = Math.abs(now.getTime() / 1000 - Number(timestamp));
  if (age > SLACK_REPLAY_WINDOW_SECONDS) return { ok: false, reason: "stale" };
  const expected = Buffer.from(slackSignature(signingSecret, timestamp, body));
  const given = Buffer.from(signature);
  // Constant time: lengths differ only for malformed signatures.
  if (expected.length !== given.length || !timingSafeEqual(expected, given))
    return { ok: false, reason: "mismatch" };
  return { ok: true };
}
