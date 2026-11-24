import { createHmac, timingSafeEqual } from "node:crypto";

// Standard Webhooks signatures (https://www.standardwebhooks.com, spec
// v1.0.0), as MCP Events webhook deliveries require: HMAC-SHA256 over
// `${id}.${timestamp}.${body}` with the base64 key after `whsec_`, sent as
// `v1,<base64>` in `webhook-signature` (space-separated when several keys
// sign during a rotation).

const PREFIX = "whsec_";
// The spec's bounds for a signing key.
const MIN_KEY_BYTES = 24;
const MAX_KEY_BYTES = 64;

// The key bytes of a `whsec_` secret, or undefined when it is not one
// (strict base64, 24 to 64 bytes).
export function signingKey(secret: string): Buffer | undefined {
  if (!secret.startsWith(PREFIX)) return undefined;
  const encoded = secret.slice(PREFIX.length);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 !== 0)
    return undefined;
  const key = Buffer.from(encoded, "base64");
  if (key.toString("base64") !== encoded) return undefined;
  if (key.length < MIN_KEY_BYTES || key.length > MAX_KEY_BYTES)
    return undefined;
  return key;
}

// Message ids and timestamps are ours, never the caller's: they must not
// contain the separator.
function signedContent(id: string, timestamp: number, body: string | Buffer) {
  if (id.includes(".")) throw new Error("A webhook id must not contain '.'.");
  return Buffer.concat([
    Buffer.from(`${id}.${timestamp}.`, "utf8"),
    typeof body === "string" ? Buffer.from(body, "utf8") : body,
  ]);
}

export function sign(
  secret: string,
  id: string,
  timestamp: number,
  body: string | Buffer,
) {
  const key = signingKey(secret);
  if (!key) throw new Error("Not a whsec_ signing secret.");
  const mac = createHmac("sha256", key)
    .update(signedContent(id, timestamp, body))
    .digest("base64");
  return `v1,${mac}`;
}

// The three Standard Webhooks headers, signed with every key given (the
// current one first).
export function webhookHeaders(
  secrets: readonly string[],
  id: string,
  timestamp: number,
  body: string,
) {
  return {
    "webhook-id": id,
    "webhook-timestamp": String(timestamp),
    "webhook-signature": secrets
      .map((secret) => sign(secret, id, timestamp, body))
      .join(" "),
  };
}

// Verification as a receiver does it (tests, the local fake receiver):
// within five minutes either way, any listed v1 signature matching in
// constant time.
export function verify(
  secret: string,
  headers: { id: string; timestamp: string; signature: string },
  body: string | Buffer,
  now = Date.now(),
) {
  const timestamp = Number(headers.timestamp);
  if (!Number.isInteger(timestamp)) return false;
  if (Math.abs(now / 1000 - timestamp) > 5 * 60) return false;
  const expected = Buffer.from(sign(secret, headers.id, timestamp, body));
  return headers.signature.split(" ").some((candidate) => {
    const given = Buffer.from(candidate);
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}
