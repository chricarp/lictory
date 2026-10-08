type AuthEnvironment = Readonly<Record<string, string | undefined>>;

// Only the nightly realm accepts its own provider-declared immutable URL.
// Client headers never add origins; production retains its canonical base URL.
export function authBaseUrl(env: AuthEnvironment) {
  const base = env.BETTER_AUTH_URL;
  const deployment = env.VERCEL_URL;
  if (
    env.LICTORY_RELEASE_CHANNEL !== "nightly" ||
    env.VERCEL !== "1" ||
    base !== "https://nightly.lictory.com" ||
    !deployment ||
    !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.vercel\.app$/.test(deployment)
  )
    return base;
  return {
    allowedHosts: ["nightly.lictory.com", deployment],
    protocol: "https" as const,
    fallback: base,
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
