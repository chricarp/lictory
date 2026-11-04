import { env, type Environment } from "@lictory/core/lib/env";

// PostHog settings for server code (API, worker): POSTHOG_PROJECT_TOKEN and
// POSTHOG_HOST, the names the deployment sets. VITE_* and NEXT_PUBLIC_* are
// build inputs for browser bundles and are never read here. Server events,
// server log export and the API's /relay stay off unless both are set.
export function posthogServerConfig(source: Environment = process.env) {
  const token = env("POSTHOG_PROJECT_TOKEN", source);
  const host = env("POSTHOG_HOST", source);
  return token && host ? { token, host } : undefined;
}
