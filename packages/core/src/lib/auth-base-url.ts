type AuthEnvironment = Readonly<Record<string, string | undefined>>;

// Nightlies and opted-in OAuth previews accept their provider-declared URL.
// Client headers never add origins; production retains its canonical base URL.
export function authBaseUrl(env: AuthEnvironment) {
  const base = env.BETTER_AUTH_URL;
  const deployment = env.VERCEL_URL;
  if (
    (env.LICTORY_RELEASE_CHANNEL !== "nightly" &&
      !(env.OAUTH_PROXY_URL && env.OAUTH_PROXY_SECRET)) ||
    env.VERCEL !== "1" ||
    env.VERCEL_ENV !== "preview" ||
    !deployment ||
    !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.vercel\.app$/.test(deployment)
  )
    return base;
  return {
    allowedHosts: [deployment],
    protocol: "https" as const,
    fallback: `https://${deployment}`,
  };
}

export function matchesAuthOrigin(
  base: ReturnType<typeof authBaseUrl>,
  origin: string | null,
  requestUrl: string,
): boolean {
  if (!origin) return false;
  if (base && typeof base !== "string")
    return base.allowedHosts.some((host) => origin === `https://${host}`);
  return origin === new URL(base ?? requestUrl).origin;
}
