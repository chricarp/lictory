import { oAuthProxy } from "better-auth/plugins";
import { platformUrl } from "@lictory/core/lib/auth-base-url";

export function oauthProxyConfig(
  env: Readonly<Record<string, string | undefined>>,
) {
  const productionURL = env.OAUTH_PROXY_URL?.trim();
  const secret = env.OAUTH_PROXY_SECRET?.trim();
  if (!productionURL && !secret) return { plugins: [], trustedOrigins: [] };
  if (!productionURL || !secret)
    throw new Error("Set both OAUTH_PROXY_URL and OAUTH_PROXY_SECRET.");

  const url = new URL(productionURL);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("OAUTH_PROXY_URL must be an HTTPS origin without a path.");
  if (secret.length < 32)
    throw new Error("OAUTH_PROXY_SECRET must contain at least 32 characters.");

  return {
    plugins: [
      oAuthProxy({
        productionURL: url.origin,
        secret,
        // Development and other trusted origins return to their own platform
        // origin after the proxy exchanged the provider code.
        currentURL: platformUrl(env),
      }),
    ],
    trustedOrigins: (env.OAUTH_PROXY_TRUSTED_ORIGINS ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  };
}
