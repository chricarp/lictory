import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";

import { env, type Environment } from "@lictory/core/lib/env";

// Delivery credentials (API tokens) are encrypted at rest with AES-256-GCM.
// The key comes from DELIVERY_CREDENTIALS_KEY, or is derived from
// BETTER_AUTH_SECRET so local development needs no extra setup. The
// organization id is bound as associated data: a ciphertext copied to another
// organization's row fails to decrypt.

const VERSION = "v1";

/**
 * Production without DELIVERY_CREDENTIALS_KEY. A new installation (no stored
 * credentials) must then not store any: its tokens would depend on
 * BETTER_AUTH_SECRET. An installation that already stored credentials with the
 * derived key keeps using it, so upgrades never make them unreadable (the API
 * and worker warn at startup). See docs/operations/configuration.md.
 */
export function derivedCredentialsKeyInProduction(environment: Environment) {
  return (
    env("NODE_ENV", environment) === "production" &&
    env("DELIVERY_CREDENTIALS_KEY", environment) === undefined
  );
}

function key(secret = process.env.DELIVERY_CREDENTIALS_KEY) {
  const material = secret?.trim() ? secret : process.env.BETTER_AUTH_SECRET;
  if (!material)
    throw new Error(
      "DELIVERY_CREDENTIALS_KEY (or BETTER_AUTH_SECRET) must be set to store delivery credentials.",
    );
  return Buffer.from(
    hkdfSync("sha256", material, "lictory", "delivery-credentials", 32),
  );
}

export function encryptCredential(
  organizationId: string,
  value: unknown,
  secret?: string,
) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(secret), iv);
  cipher.setAAD(Buffer.from(organizationId));
  const data = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return [VERSION, iv, cipher.getAuthTag(), data]
    .map((part) =>
      typeof part === "string" ? part : part.toString("base64url"),
    )
    .join(":");
}

export function decryptCredential<T>(
  organizationId: string,
  encoded: string,
  secret?: string,
): T {
  const [version, iv, tag, data] = encoded.split(":");
  if (version !== VERSION || !iv || !tag || !data)
    throw new Error("Unsupported delivery credential format.");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key(secret),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAAD(Buffer.from(organizationId));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(data, "base64url")),
    decipher.final(),
  ]);
  return JSON.parse(plain.toString("utf8")) as T;
}
