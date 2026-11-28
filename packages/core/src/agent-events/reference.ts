// How a receiver checks a Lictory webhook delivery, as the agent events
// reference prints it (scripts/mcp-reference.ts). A test runs this exact
// text against real deliveries, so the documented snippet cannot rot.
export const verificationSnippet = `import { createHmac, timingSafeEqual } from "node:crypto";

// secret: the webhook's secret (Wake-ups or Account settings → Event
// webhooks), or the whsec_ key your MCP client subscribed with.
// headers: the request headers, lowercase names. body: the raw body text.
export function verifyLictoryWebhook(secret, headers, body, now = Date.now()) {
  const id = headers["webhook-id"];
  const timestamp = Number(headers["webhook-timestamp"]);
  if (!id || !Number.isInteger(timestamp)) return false;
  // Refuse old or future deliveries, so a logged request cannot be replayed.
  if (Math.abs(now / 1000 - timestamp) > 5 * 60) return false;
  const key = secret.startsWith("whsec_")
    ? Buffer.from(secret.slice("whsec_".length), "base64")
    : Buffer.from(secret, "utf8");
  const expected = createHmac("sha256", key)
    .update(\`\${id}.\${timestamp}.\${body}\`)
    .digest();
  // Several signatures are sent while a subscription's key rotates.
  return (headers["webhook-signature"] ?? "").split(" ").some((entry) => {
    const [version, mac] = entry.split(",");
    if (version !== "v1" || !mac) return false;
    const given = Buffer.from(mac, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}
`;
