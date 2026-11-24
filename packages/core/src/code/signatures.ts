import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type {
  VerifiedWebhook,
  WebhookRequest,
} from "@lictory/core/code/provider";

// Webhook signature schemes, one per host. Each check is constant-time and
// runs before the body is parsed. A valid signature proves the delivery came
// from a holder of the connection's secret; it never authorizes anything by
// itself (docs/internals/software-factory.md#authority-what-text-and-agents-can-never-do).
// Replays are stopped by the inbox, which stores each delivery id once, and
// by ingest, which never lets an older payload overwrite a newer mirror.

function sameBytes(a: Buffer, b: Buffer) {
  return a.length === b.length && timingSafeEqual(a, b);
}

// Compares fixed-length digests, so neither length nor content leaks.
function sameSecret(a: string, b: string) {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(a), digest(b));
}

function hmacMatches(header: string | undefined, secret: string, body: string) {
  const match = /^sha256=([0-9a-f]{64})$/i.exec(header?.trim() ?? "");
  if (!match || !secret) return false;
  const expected = createHmac("sha256", secret).update(body, "utf8").digest();
  return sameBytes(Buffer.from(match[1]!.toLowerCase(), "hex"), expected);
}

// The value the host signs, for tests and the stand-ins that send
// webhooks.
export function hmacSignature(secret: string, body: string) {
  return `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
}

const bounded = (value: string | undefined) => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length <= 200 ? trimmed : undefined;
};

// GitHub: X-Hub-Signature-256 is HMAC SHA-256 of the body.
export function verifyGitHubWebhook(
  request: WebhookRequest,
  secret: string,
): VerifiedWebhook | null {
  if (
    !hmacMatches(request.headers["x-hub-signature-256"], secret, request.body)
  )
    return null;
  const deliveryId = bounded(request.headers["x-github-delivery"]);
  const event = bounded(request.headers["x-github-event"]);
  return deliveryId && event ? { deliveryId, event } : null;
}

// GitLab: X-Gitlab-Token carries the secret itself. The delivery id is
// X-Gitlab-Event-UUID (GitLab 15.4+); older versions send none, so the body
// digest stands in and identical retries still collapse.
export function verifyGitLabWebhook(
  request: WebhookRequest,
  secret: string,
): VerifiedWebhook | null {
  const token = request.headers["x-gitlab-token"];
  if (!secret || token === undefined || !sameSecret(token, secret)) return null;
  const event = bounded(request.headers["x-gitlab-event"]);
  if (!event) return null;
  const deliveryId =
    bounded(request.headers["x-gitlab-event-uuid"]) ??
    bounded(request.headers["idempotency-key"]) ??
    `body:${createHash("sha256").update(request.body).digest("hex")}`;
  return { deliveryId, event };
}

// Bitbucket Cloud: X-Hub-Signature is HMAC SHA-256 of the body.
export function verifyBitbucketWebhook(
  request: WebhookRequest,
  secret: string,
): VerifiedWebhook | null {
  if (!hmacMatches(request.headers["x-hub-signature"], secret, request.body))
    return null;
  const deliveryId = bounded(request.headers["x-request-uuid"]);
  const event = bounded(request.headers["x-event-key"]);
  return deliveryId && event ? { deliveryId, event } : null;
}
