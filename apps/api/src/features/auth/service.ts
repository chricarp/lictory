import { expo } from "@better-auth/expo";
import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { bearer } from "better-auth/plugins";
import { importPKCS8, SignJWT } from "jose";

import type { Env } from "../../bindings";

const LOCAL_AUTH_SECRET =
  "lictory-local-development-secret-change-before-deploying";

function values(value: string | undefined) {
  return value
    ?.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

async function createAppleClientSecret(env: Env) {
  if (
    !env.APPLE_CLIENT_ID ||
    !env.APPLE_TEAM_ID ||
    !env.APPLE_KEY_ID ||
    !env.APPLE_PRIVATE_KEY
  ) {
    return env.APPLE_CLIENT_SECRET;
  }

  const key = await importPKCS8(
    env.APPLE_PRIVATE_KEY.replaceAll("\\n", "\n"),
    "ES256",
  );
  const now = Math.floor(Date.now() / 1_000);

  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: env.APPLE_KEY_ID })
    .setIssuer(env.APPLE_TEAM_ID)
    .setSubject(env.APPLE_CLIENT_ID)
    .setAudience("https://appleid.apple.com")
    .setIssuedAt(now)
    .setExpirationTime(now + 180 * 24 * 60 * 60)
    .sign(key);
}

export function createAuth(env: Env) {
  const allowedOrigins = values(env.ALLOWED_ORIGINS) ?? [];
  const passkeyOrigins = values(env.PASSKEY_ORIGINS) ?? allowedOrigins;
  const appleConfigured = Boolean(
    env.APPLE_CLIENT_ID &&
    (env.APPLE_CLIENT_SECRET ||
      (env.APPLE_TEAM_ID && env.APPLE_KEY_ID && env.APPLE_PRIVATE_KEY)),
  );

  return betterAuth({
    appName: "Lictory",
    baseURL: env.BETTER_AUTH_URL,
    database: env.DB,
    secret:
      env.BETTER_AUTH_SECRET ??
      (env.ENVIRONMENT === "development" ? LOCAL_AUTH_SECRET : undefined),
    trustedOrigins: [
      ...allowedOrigins,
      "lictory://",
      "https://appleid.apple.com",
      ...(env.ENVIRONMENT === "development" ? ["exp://", "exp://**"] : []),
    ],
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
    },
    socialProviders: {
      ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? {
            google: {
              clientId: env.GOOGLE_CLIENT_ID,
              clientSecret: env.GOOGLE_CLIENT_SECRET,
              prompt: "select_account" as const,
            },
          }
        : {}),
      ...(appleConfigured
        ? {
            apple: async () => ({
              clientId: env.APPLE_CLIENT_ID!,
              clientSecret: (await createAppleClientSecret(env))!,
              ...(env.APPLE_APP_BUNDLE_IDENTIFIER
                ? { appBundleIdentifier: env.APPLE_APP_BUNDLE_IDENTIFIER }
                : {}),
            }),
          }
        : {}),
    },
    plugins: [
      expo(),
      bearer(),
      passkey({
        rpID: env.PASSKEY_RP_ID,
        rpName: "Lictory",
        origin: passkeyOrigins,
      }),
    ],
  });
}

export async function authenticate(
  headers: Headers,
  env: Env,
): Promise<string | null> {
  const authorization = headers.get("authorization");
  if (
    env.ENVIRONMENT === "development" &&
    authorization?.startsWith("Bearer dev:")
  ) {
    return authorization.slice("Bearer dev:".length) || null;
  }

  try {
    const session = await createAuth(env).api.getSession({ headers });
    return session?.user.id ?? null;
  } catch {
    return null;
  }
}
