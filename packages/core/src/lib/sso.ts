import type { BetterAuthOptions } from "better-auth";
import { genericOAuth, type GenericOAuthUserInfo } from "better-auth/plugins";
import { APIError, getOAuthState } from "better-auth/api";

// Instance-level single sign-on through a company OpenID Connect identity
// provider (Okta, Entra ID, Keycloak, Authentik, Google Workspace, Dex…), and
// the switch that turns email/password sign-in off for SSO-only instances.
// Configured by the operator through the environment; see
// docs/operations/sso.md. Empty variables count as unset.

type Environment = Readonly<Record<string, string | undefined>>;

// Better Auth's provider id: the callback is /api/auth/callback/oidc.
export const OIDC_PROVIDER_ID = "oidc";
const DISCOVERY_PATH = "/.well-known/openid-configuration";

export type OidcSettings = {
  discoveryUrl: string;
  clientId: string;
  clientSecret: string;
  scopes: string[];
  displayName: string;
  autoCreateUsers: boolean;
};

function setting(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed === "" ? undefined : trimmed;
}

function flag(env: Environment, name: string, fallback: boolean) {
  const value = setting(env[name])?.toLowerCase();
  if (value === undefined) return fallback;
  if (["true", "1", "yes"].includes(value)) return true;
  if (["false", "0", "no"].includes(value)) return false;
  throw new Error(`${name} must be true or false.`);
}

const isLoopback = (host: string) =>
  ["localhost", "127.0.0.1", "[::1]"].includes(host);

// The issuer (or its discovery document) comes from the operator. ID tokens
// are verified against the issuer and keys that discovery publishes, so it
// must be HTTPS outside local development.
function discoveryUrl(issuer: string) {
  let url: URL;
  try {
    url = new URL(issuer);
  } catch {
    throw new Error("OIDC_ISSUER must be a URL.");
  }
  if (
    !(
      url.protocol === "https:" ||
      (url.protocol === "http:" && isLoopback(url.hostname))
    ) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "OIDC_ISSUER must be an HTTPS URL without credentials, query or fragment.",
    );
  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = path.endsWith(DISCOVERY_PATH) ? path : path + DISCOVERY_PATH;
  return url.toString();
}

export function oidcSettings(
  env: Environment = process.env,
): OidcSettings | null {
  const issuer = setting(env.OIDC_ISSUER);
  const clientId = setting(env.OIDC_CLIENT_ID);
  const clientSecret = setting(env.OIDC_CLIENT_SECRET);
  if (!issuer && !clientId && !clientSecret) return null;
  if (!issuer || !clientId || !clientSecret)
    throw new Error(
      "Set OIDC_ISSUER, OIDC_CLIENT_ID and OIDC_CLIENT_SECRET together to enable single sign-on.",
    );
  // Lictory identifies people by email, so `email` is always requested.
  const scopes = new Set(["openid", "email"]);
  for (const scope of (setting(env.OIDC_SCOPES) ?? "profile").split(/[\s,]+/))
    if (scope) scopes.add(scope);
  return {
    discoveryUrl: discoveryUrl(issuer),
    clientId,
    clientSecret,
    scopes: [...scopes],
    displayName: setting(env.OIDC_DISPLAY_NAME) ?? "SSO",
    autoCreateUsers: flag(env, "OIDC_AUTO_CREATE_USERS", true),
  };
}

// `email_verified` is the identity provider's statement that it checked the
// mailbox. Only then may a sign-in link to an existing Lictory account with the
// same (verified) email, and only then is a new account's email trusted without
// Lictory's own verification email. Many providers omit the claim (Entra ID
// does), which is the safe outcome: no implicit linking.
function verifiedEmail(profile: GenericOAuthUserInfo) {
  const claim = profile.email_verified;
  return claim === true || claim === "true";
}

function displayName(profile: GenericOAuthUserInfo) {
  const given = [profile.given_name, profile.family_name]
    .filter((part) => typeof part === "string" && part.trim())
    .join(" ");
  // Empty names fall through to the next candidate.
  const name = profile.name?.trim();
  if (name) return name;
  if (given) return given;
  return typeof profile.preferred_username === "string"
    ? profile.preferred_username
    : (profile.email ?? "");
}

export function oidcPlugins(settings: OidcSettings | null) {
  if (!settings) return [];
  return [
    genericOAuth({
      config: [
        {
          providerId: OIDC_PROVIDER_ID,
          name: settings.displayName,
          discoveryUrl: settings.discoveryUrl,
          // Without the issuer and JWKS from discovery the provider is not
          // registered at all, rather than accepting unverified ID tokens.
          requireIdTokenVerification: true,
          clientId: settings.clientId,
          clientSecret: settings.clientSecret,
          scopes: settings.scopes,
          pkce: true,
          // Without auto-creation only people who already have a Lictory
          // account can sign in with the provider.
          disableSignUp: !settings.autoCreateUsers,
          // Names and photos are edited in Lictory; the provider never
          // overwrites them after the first sign-in.
          overrideUserInfo: false,
          // No session until the email is verified, by the provider's claim
          // or by Lictory's verification email.
          requireEmailVerification: true,
          // Signing out of Lictory ends the Lictory session only, as for
          // Google and Microsoft.
          disableProviderLogout: true,
          mapProfileToUser: (profile) => ({
            name: displayName(profile),
            emailVerified: verifiedEmail(profile),
          }),
        },
      ],
    }),
  ];
}

// PASSWORD_LOGIN_ENABLED=false makes an SSO-only instance: Better Auth then
// rejects email/password sign-in and sign-up, and the reset flow is closed
// (see `passwordFlowClosed`). Turning it off without any identity provider
// would lock everyone out, so that is a configuration error.
export function passwordLoginEnabled(
  env: Environment,
  identityProviderConfigured: boolean,
) {
  const enabled = flag(env, "PASSWORD_LOGIN_ENABLED", true);
  if (!enabled && !identityProviderConfigured)
    throw new Error(
      "PASSWORD_LOGIN_ENABLED=false requires an identity provider (OIDC, Google or Microsoft); nobody could sign in otherwise.",
    );
  return enabled;
}

const PASSWORD_PATHS = new Set([
  "/sign-in/email",
  "/sign-up/email",
  "/request-password-reset",
  "/reset-password",
]);

// Rejects password endpoints Better Auth keeps open when email/password
// sign-in is disabled (resetting a password nobody can use only sends email).
export function passwordFlowClosed(path: string, passwordLogin: boolean) {
  if (passwordLogin || !PASSWORD_PATHS.has(path)) return;
  throw new APIError("BAD_REQUEST", {
    code: "PASSWORD_LOGIN_DISABLED",
    message:
      "Password sign-in is turned off on this installation. Sign in with your company account.",
  });
}

type ValidateUserInfo = NonNullable<
  NonNullable<BetterAuthOptions["user"]>["validateUserInfo"]
>;

// The provider is listed as trusted so that a signed-in person can connect it
// from Account settings even when it omits `email_verified` (the same email is
// still required). This gate keeps that trust to explicit links: linking an
// existing account during sign-in needs the provider's `email_verified` claim,
// as mapped by `oidcPlugins`.
export const validateOidcAccountLink: ValidateUserInfo = async (
  { user, source },
  context,
) => {
  if (
    source.oauth?.providerId !== OIDC_PROVIDER_ID ||
    source.action !== "link-account" ||
    user.emailVerified === true
  )
    return;
  // Better Auth owns `link` in validated OAuth state; client additionalData
  // cannot replace it.
  const link = (await getOAuthState())?.link;
  if (
    user.id &&
    (link?.userId === user.id || context.context.session?.user.id === user.id)
  )
    return;
  return { error: "account_not_linked" };
};
