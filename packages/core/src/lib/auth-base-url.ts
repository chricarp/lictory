type Environment = Readonly<Record<string, string | undefined>>;

// The platform's one public origin (https://app.lictory.com): Better Auth's
// base URL, links in email, Jira backlinks and the exact-origin check for
// cookie-authenticated writes. Client headers never add origins. Outside
// production, BETTER_AUTH_URL and then the local dev origin are fallbacks.
// Empty variables count as unset.
function setting(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed === "" ? undefined : trimmed;
}

export function platformUrl(env: Environment = process.env): string {
  const raw =
    setting(env.PLATFORM_URL) ??
    (env.NODE_ENV === "production"
      ? undefined
      : (setting(env.BETTER_AUTH_URL) ?? "http://localhost:3000"));
  if (!raw) throw new Error("PLATFORM_URL is required.");
  const url = new URL(raw);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("PLATFORM_URL must be an origin without a path.");
  return url.origin;
}

// The marketing site (https://lictory.com): legal pages and other public links.
export function siteUrl(env: Environment = process.env): string {
  return new URL(setting(env.SITE_URL) ?? platformUrl(env)).origin;
}

export function matchesPlatformOrigin(
  origin: string | null,
  env: Environment = process.env,
): boolean {
  return Boolean(origin) && origin === platformUrl(env);
}
